/**
 * MTProto client for Telegram file streaming (files > 20 MB).
 *
 * Uses GramJS (`telegram` npm package) with BOT authentication — no phone
 * number, no 2FA, no manual session string. The session is automatically
 * created, stored server-side, and recovered on restart using the bot token.
 *
 * Required env vars:
 *   TELEGRAM_BOT_TOKEN  — from @BotFather
 *   TELEGRAM_API_ID     — from https://my.telegram.org
 *   TELEGRAM_API_HASH   — from https://my.telegram.org
 *
 * No TELEGRAM_MTPROTO_SESSION or any manual session string is ever needed.
 * The session is created on first boot, persisted to Neon PostgreSQL, and
 * re-created automatically if lost or expired (using the bot token).
 *
 * This module is ADDITIVE — it does not touch the existing Bot API client,
 * webhook handler, indexer, or any other part of the Telegram system.
 * Bot API continues to handle webhook/indexing/message management.
 * MTProto is used ONLY for file download/streaming.
 */
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import bigInt from "big-integer";
import nodeFs from "node:fs";
import nodePath from "node:path";
import { logger } from "../logger";
import { db } from "@workspace/db";
import { appSecretsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// ── Configuration ───────────────────────────────────────────────────────────

const SESSION_DIR = process.env.TELEGRAM_SESSION_DIR || "/data";
const SESSION_FILE = nodePath.join(SESSION_DIR, "telegram-session.json");

/** Key used to store the MTProto session in the app_secrets table (Neon). */
const SESSION_DB_KEY = "telegram_mtproto_session";

/** MTProto chunk size — 512 KB (max per upload.GetFile request). */
const CHUNK_SIZE = 524288;

/** Bot API getFile limit — files above this MUST use MTProto. */
export const BOT_API_THRESHOLD = 20 * 1024 * 1024;

function getCredentials(): { apiId: number; apiHash: string; botToken: string } {
  const apiId = parseInt(process.env.TELEGRAM_API_ID || "", 10);
  const apiHash = process.env.TELEGRAM_API_HASH || "";
  const botToken = process.env.TELEGRAM_BOT_TOKEN || "";
  return { apiId, apiHash, botToken };
}

/** True when all three MTProto credentials are present and valid. */
export function isMtProtoConfigured(): boolean {
  const { apiId, apiHash, botToken } = getCredentials();
  return !Number.isNaN(apiId) && apiId > 0 && !!apiHash && !!botToken;
}

// ── Singleton state ─────────────────────────────────────────────────────────

let client: TelegramClient | null = null;
let connectionState: "disconnected" | "connecting" | "connected" | "error" | "skipped" = "disconnected";
let connectionError: string | null = null;
let initPromise: Promise<void> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

// ── Session management ──────────────────────────────────────────────────────

/**
 * Load the MTProto session from Neon PostgreSQL (primary).
 * Falls back to the file system for one-time migration of existing sessions.
 * Returns an empty StringSession if neither source has a valid session.
 * Never logs the session string itself.
 */
async function loadSession(): Promise<StringSession> {
  // 1. Primary: load from Neon PostgreSQL (app_secrets table)
  try {
    const [row] = await db
      .select({ value: appSecretsTable.value })
      .from(appSecretsTable)
      .where(eq(appSecretsTable.key, SESSION_DB_KEY))
      .limit(1);
    if (row?.value && row.value.length > 0) {
      logger.info("[TELEGRAM] MTProto: session loaded from Neon PostgreSQL");
      return new StringSession(row.value);
    }
  } catch (err: any) {
    logger.warn(
      { code: typeof err?.code === "string" ? err.code : undefined },
      "[TELEGRAM] MTProto: DB session load failed — trying file fallback",
    );
  }

  // 2. Migration fallback: load from file if it exists (one-time migration)
  try {
    const data = await nodeFs.promises.readFile(SESSION_FILE, "utf-8");
    const parsed = JSON.parse(data);
    if (parsed.session && typeof parsed.session === "string") {
      logger.info("[TELEGRAM] MTProto: session loaded from file — will migrate to Neon");
      return new StringSession(parsed.session);
    }
  } catch (err: any) {
    if (err?.code !== "ENOENT") {
      logger.warn({ err: err.message }, "[TELEGRAM] MTProto: session file read error — will re-authenticate");
    }
  }

  return new StringSession("");
}

/**
 * Save the MTProto session to Neon PostgreSQL (primary) and the file system (backup).
 * Never logs the session string.
 */
async function saveSession(sessionString: string): Promise<void> {
  if (!sessionString) {
    logger.error("[TELEGRAM] MTProto session serialization returned an empty value; session was not persisted");
    return;
  }

  // 1. Primary: save to Neon PostgreSQL (upsert)
  try {
    await db
      .insert(appSecretsTable)
      .values({ key: SESSION_DB_KEY, value: sessionString })
      .onConflictDoUpdate({
        target: appSecretsTable.key,
        set: { value: sessionString, updatedAt: new Date() },
      });
    logger.info("[TELEGRAM] MTProto: session saved to Neon PostgreSQL");
  } catch (err: any) {
    logger.warn(
      { code: typeof err?.code === "string" ? err.code : undefined },
      "[TELEGRAM] MTProto: DB session save failed — trying file fallback",
    );
  }

  // 2. Backup: also write to file (best-effort, never throws)
  try {
    await nodeFs.promises.mkdir(SESSION_DIR, { recursive: true });
    await nodeFs.promises.writeFile(
      SESSION_FILE,
      JSON.stringify({ session: sessionString, savedAt: new Date().toISOString() }),
      { mode: 0o600 },
    );
  } catch {
    // File save is best-effort — Neon is the primary store.
  }
}

// ── Initialization ───────────────────────────────────────────────────────────

/**
 * Initialize the MTProto client — singleton.
 *
 * Steps:
 *   1. Validate TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_BOT_TOKEN
 *   2. Create a GramJS TelegramClient
 *   3. Load the session from file (or empty session if none)
 *   4. Connect to Telegram
 *   5. If not authorized: authenticate as bot using the bot token
 *   6. Save the session for future restarts
 *   7. Verify the connection with getMe()
 *
 * If any step fails, the state is set to "error" and the function returns
 * without throwing — the Bot API continues to work independently. Large-file
 * streaming is disabled until the issue is resolved.
 *
 * This function is idempotent — calling it multiple times is safe.
 */
/**
 * Parse the flood-wait duration (in seconds) from a Telegram error message.
 * Returns null if the error is not a flood-wait error.
 */
function parseFloodWait(errMsg: string): number | null {
  const match = errMsg.match(/A wait of (\d+) seconds is required/i);
  if (match) return parseInt(match[1], 10);
  return null;
}

export async function initMtProto(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = doInit().catch((err) => {
    initPromise = null; // allow retry on next call
    throw err;
  });
  return initPromise;
}

async function doInit(): Promise<void> {
  if (!isMtProtoConfigured()) {
    const { apiId, apiHash, botToken } = getCredentials();
    const missing: string[] = [];
    if (Number.isNaN(apiId) || apiId <= 0) missing.push("TELEGRAM_API_ID");
    if (!apiHash) missing.push("TELEGRAM_API_HASH");
    if (!botToken) missing.push("TELEGRAM_BOT_TOKEN");
    logger.info(
      `[TELEGRAM] MTProto: not configured (${missing.join(", ")} missing). Large-file streaming (>20 MB) requires TELEGRAM_BOT_TOKEN + TELEGRAM_API_ID + TELEGRAM_API_HASH. Bot API continues to work for files ≤20 MB.`,
    );
    return;
  }

  const { apiId, apiHash, botToken } = getCredentials();

  connectionState = "connecting";
  logger.info("[TELEGRAM] MTProto: initializing...");

  try {
    const session = await loadSession();

    client = new TelegramClient(session, apiId, apiHash, {
      connectionRetries: 5,
      retryDelay: 2000,
      autoReconnect: true,
      timeout: 30000,
    });

    await client.connect();

    // Check if the saved session is still valid.
    let authorized = false;
    try {
      authorized = await client.isUserAuthorized();
    } catch {
      authorized = false;
    }

    if (!authorized) {
      logger.info("[TELEGRAM] MTProto: session not authorized, authenticating as bot...");
      await client.signInBot({ apiId, apiHash }, { botAuthToken: botToken });
      const sessionString = (client.session as any).save() as string;
      await saveSession(sessionString);
      logger.info("[TELEGRAM] MTProto: bot authenticated, session saved automatically");
    } else {
      // Session still valid — persist it (in case it changed during connect).
      const sessionString = (client.session as any).save() as string;
      await saveSession(sessionString);
      logger.info("[TELEGRAM] MTProto: existing session is valid");
    }

    // Verify the connection with a lightweight getMe call.
    const me = await client.getMe();
    connectionState = "connected";
    connectionError = null;
    logger.info(
      { botId: (me as any)?.id, username: (me as any)?.username },
      "[TELEGRAM] MTProto: connected",
    );
    logger.info("[TELEGRAM] MTProto session: ready (managed automatically, no manual session needed)");
  } catch (err: any) {
    connectionState = "error";
    connectionError = sanitizeError(err.message || String(err));
    logger.error(
      { err: connectionError },
      "[TELEGRAM] MTProto: initialization failed — large-file streaming disabled (Bot API still works for files ≤20 MB)",
    );

    // If this is a flood-wait error, schedule an automatic retry after the
    // required wait time. This avoids hammering Telegram's auth endpoint on
    // every restart while the rate limit is active.
    const waitSeconds = parseFloodWait(err.message || String(err));
    if (waitSeconds !== null) {
      const waitMs = (waitSeconds + 5) * 1000; // small buffer
      logger.info(
        `[TELEGRAM] MTProto: Telegram requires ${waitSeconds}s wait before retry. Scheduling retry in ${waitSeconds}s...`,
      );
      retryTimer = setTimeout(async () => {
        retryTimer = null;
        initPromise = null; // clear so doInit runs fresh
        try {
          await initMtProto();
        } catch {
          // Error already logged inside doInit; nothing to do here.
        }
      }, waitMs);
    }

    // Do NOT throw — the app must continue running. Bot API is unaffected.
  }
}

// ── Health & status ─────────────────────────────────────────────────────────

/**
 * Mark MTProto as intentionally skipped — used when a Local Bot API Server is
 * configured (TELEGRAM_API_BASE set). The local server supports files up to
 * 2 GB, so MTProto is not needed. This prevents the UI from showing "error"
 * for something that was deliberately not initialized.
 */
export function markMtProtoSkipped(): void {
  connectionState = "skipped";
  connectionError = null;
}

/** True when MTProto is connected and ready to stream files. */
export function isMtProtoReady(): boolean {
  return connectionState === "connected" && client !== null;
}

export interface MtProtoHealth {
  enabled: boolean;
  connected: boolean;
  authenticated: boolean;
  sessionManagedAutomatically: boolean;
  authType: string;
  apiIdConfigured: boolean;
  state: "disconnected" | "connecting" | "connected" | "error" | "skipped";
  error: string | null;
}

/** Return a sanitized health object — never exposes secrets. */
export function getMtProtoStatus(): MtProtoHealth {
  return {
    enabled: isMtProtoConfigured(),
    connected: connectionState === "connected",
    authenticated: connectionState === "connected",
    sessionManagedAutomatically: true,
    authType: "bot",
    apiIdConfigured: !Number.isNaN(getCredentials().apiId) && getCredentials().apiId > 0,
    state: connectionState,
    error: connectionError,
  };
}

// ── File streaming ──────────────────────────────────────────────────────────

export interface MtProtoStreamResult {
  /** Async generator yielding Buffer chunks for the requested byte range. */
  chunks: AsyncGenerator<Buffer>;
  /** Total file size in bytes (from the Telegram document). */
  fileSize: number;
}

/**
 * Get a byte-range stream from Telegram via MTProto.
 *
 * Uses GramJS's `iterDownload` with an offset to download only the requested
 * bytes — the entire file is NEVER loaded into RAM. Each chunk is yielded
 * immediately to the HTTP response with backpressure.
 *
 * File reference recovery: if the file reference is expired mid-stream, the
 * generator automatically re-fetches the message (which refreshes the
 * reference) and continues from where it left off.
 *
 * @param chatId    Telegram chat ID (string, e.g. "-100123456789")
 * @param messageId Telegram message ID (string, e.g. "42")
 * @param startByte Start byte offset (inclusive)
 * @param endByte   End byte offset (inclusive), or null for end-of-file
 */
export async function getMtProtoFileStream(
  chatId: string,
  messageId: string,
  startByte: number,
  endByte: number | null,
): Promise<MtProtoStreamResult> {
  if (!isMtProtoReady() || !client) {
    throw new Error("MTProto client not initialized");
  }

  return doMtProtoDownload(client, chatId, messageId, startByte, endByte, false);
}

/**
 * Fetch a message via MTProto and extract its document info (file size, mime type).
 * Used by the streamer to get the file size for Range parsing when the DB
 * file size is missing.
 */
export async function getMtProtoFileInfo(
  chatId: string,
  messageId: string,
): Promise<{ fileSize: number; mimeType: string }> {
  if (!isMtProtoReady() || !client) {
    throw new Error("MTProto client not initialized");
  }

  const message = await fetchMessage(client, chatId, messageId);
  const doc = extractDocument(message);
  return {
    fileSize: Number(doc.size),
    mimeType: (doc.mimeType as string) || "video/mp4",
  };
}

// ── Internal helpers ────────────────────────────────────────────────────────

/** Fetch a single message by chat ID + message ID via MTProto. */
async function fetchMessage(
  client: TelegramClient,
  chatId: string,
  messageId: string,
): Promise<any> {
  const chatIdNum = parseInt(chatId, 10);
  const msgIdNum = parseInt(messageId, 10);

  if (Number.isNaN(chatIdNum) || Number.isNaN(msgIdNum)) {
    throw new Error(`Invalid chat ID or message ID: chatId=${chatId}, messageId=${messageId}`);
  }

  const messages = await client.getMessages(chatIdNum, { ids: [msgIdNum] });
  const message = messages?.[0];

  if (!message) {
    throw new Error("Message not found via MTProto — the bot may not have access to this chat");
  }

  // Check for empty message (GramJS returns a fake empty message when the
  // message doesn't exist or is inaccessible).
  if ((message as any).empty !== undefined && (message as any).empty === true) {
    throw new Error("Message not accessible via MTProto — the bot may not have access to this chat");
  }

  return message;
}

/** Extract the document from a message's media. Throws for non-file messages. */
function extractDocument(message: any): any {
  const media = message.media;
  if (!media) {
    throw new Error("Message has no media");
  }

  const doc = media.document;
  if (!doc) {
    throw new Error("Message media has no document — not a file/video");
  }

  return doc;
}

/**
 * Perform the MTProto download for a byte range.
 *
 * Creates an `InputDocumentFileLocation` from the message's document, then
 * uses `iterDownload` with the specified offset. The async generator is
 * wrapped to limit output to the requested byte range.
 *
 * If `isRetry` is false and the download fails with a file reference error,
 * the generator automatically re-fetches the message and retries.
 */
async function doMtProtoDownload(
  client: TelegramClient,
  chatId: string,
  messageId: string,
  startByte: number,
  endByte: number | null,
  isRetry: boolean,
): Promise<MtProtoStreamResult> {
  const message = await fetchMessage(client, chatId, messageId);
  const doc = extractDocument(message);

  const fileSize = Number(doc.size);
  if (!fileSize || fileSize <= 0) {
    throw new Error("Could not determine file size from MTProto document");
  }

  const actualEndByte = endByte !== null ? endByte : fileSize - 1;
  const bytesToDownload = actualEndByte - startByte + 1;

  if (bytesToDownload <= 0) {
    throw new Error(`Invalid byte range: start=${startByte}, end=${actualEndByte}, fileSize=${fileSize}`);
  }

  // Construct the MTProto file location for the document.
  const fileLocation = new Api.InputDocumentFileLocation({
    id: doc.id,
    accessHash: doc.accessHash,
    fileReference: doc.fileReference,
    thumbSize: "", // empty string = the actual file, not a thumbnail
  });

  // Create the download iterator with the specified offset.
  // fileSize MUST be passed so GramJS uses GenericDownloadIter for non-zero
  // offsets — DirectDownloadIter sends the raw offset to upload.GetFile,
  // which rejects non-aligned offsets with LIMIT_INVALID.
  const offset = bigInt(startByte);
  const iter = client.iterDownload({
    file: fileLocation,
    offset,
    requestSize: CHUNK_SIZE,
    dcId: doc.dcId,
    fileSize: bigInt(fileSize),
  });

  // Wrap the iterator to:
  // 1. Limit output to the requested byte range
  // 2. Handle file reference recovery (re-fetch message + retry)
  async function* rangeLimitedStream(): AsyncGenerator<Buffer> {
    let bytesSent = 0;
    try {
      for await (const chunk of iter) {
        const remaining = bytesToDownload - bytesSent;
        if (remaining <= 0) break;

        if (chunk.length > remaining) {
          // Last chunk — trim to exact remaining bytes.
          yield chunk.subarray(0, remaining) as Buffer;
          bytesSent += remaining;
          break;
        }
        yield chunk;
        bytesSent += chunk.length;
      }
    } catch (err: any) {
      // File reference expired — recover by re-fetching the message.
      if (!isRetry && isFileReferenceError(err)) {
        logger.info("[TELEGRAM MTProto] File reference expired, refreshing and retrying...");
        const retryResult = await doMtProtoDownload(
          client,
          chatId,
          messageId,
          startByte + bytesSent, // continue from where we left off
          endByte,
          true, // mark as retry to prevent infinite loops
        );
        // Yield the remaining chunks from the retry.
        for await (const chunk of retryResult.chunks) {
          yield chunk;
        }
        return;
      }
      throw err;
    }
  }

  return {
    chunks: rangeLimitedStream(),
    fileSize,
  };
}

/** Check if an error is a Telegram file reference expiration error. */
function isFileReferenceError(err: any): boolean {
  const msg = (err?.message || String(err)).toLowerCase();
  return (
    msg.includes("file_reference") ||
    msg.includes("file reference") ||
    msg.includes("filereference") ||
    err?.errorMessage === "FILE_REFERENCE_EXPIRED"
  );
}

/** Sanitize an error message — never expose tokens, hashes, or secrets. */
function sanitizeError(message: string): string {
  return message
    .replace(/bot\d+:[\w-]+/gi, "***") // bot tokens
    .replace(/[A-Za-z0-9_-]{30,}/g, "***") // long secrets (api_hash, etc.)
    .substring(0, 500);
}

// ── Message polling (for AutoUP) ─────────────────────────────────────────────

export interface MtProtoVideoMessage {
  messageId: string;
  caption: string | null;
  date: Date;
  /** Telegram document ID (used as fileUniqueId for dedup). */
  documentId: string;
  fileSize: number;
  mimeType: string;
  duration: number | null;
  width: number | null;
  height: number | null;
  fileName: string | null;
}

/**
 * Fetch new video messages from a chat via MTProto, starting after `minMessageId`.
 *
 * Uses the existing singleton MTProto client — no new connection is created.
 * Returns only messages that contain a video document (mime type starts with
 * "video/"). Non-video messages are filtered out but their IDs are still
 * accounted for (the caller updates lastProcessedMessageId to the highest
 * message ID seen, not just video IDs).
 *
 * @param chatId        Telegram chat ID (string, e.g. "-100123456789")
 * @param minMessageId  Return messages with ID > this value (string, "0" for all)
 * @param limit         Max messages to fetch per call (default 50)
 * @returns Array of video messages + the highest message ID seen (any type)
 */
export async function getNewVideoMessages(
  chatId: string,
  minMessageId: string,
  limit: number = 50,
): Promise<{ videos: MtProtoVideoMessage[]; maxMessageId: string }> {
  if (!isMtProtoReady() || !client) {
    throw new Error("MTProto client not initialized");
  }

  const chatIdNum = parseInt(chatId, 10);
  const minIdNum = parseInt(minMessageId, 10) || 0;

  if (Number.isNaN(chatIdNum)) {
    throw new Error(`Invalid chat ID: ${chatId}`);
  }

  const messages = await client.getMessages(chatIdNum, {
    minId: minIdNum,
    limit,
  });

  const videos: MtProtoVideoMessage[] = [];
  let maxId = minIdNum;

  for (const msg of messages) {
    if (!msg || (msg as any).empty === true) continue;

    const msgId = Number((msg as any).id);
    if (msgId > maxId) maxId = msgId;

    const media = (msg as any).media;
    if (!media || !media.document) continue;

    const doc = media.document;
    const mimeType: string = doc.mimeType || "";
    if (!mimeType.startsWith("video/")) continue;

    // Extract video attributes (duration, dimensions, filename).
    let duration: number | null = null;
    let width: number | null = null;
    let height: number | null = null;
    let fileName: string | null = null;

    for (const attr of doc.attributes || []) {
      if (attr instanceof Api.DocumentAttributeVideo) {
        duration = Number((attr as any).duration) || null;
        width = Number((attr as any).w) || null;
        height = Number((attr as any).h) || null;
      } else if (attr instanceof Api.DocumentAttributeFilename) {
        fileName = (attr as any).fileName || null;
      }
    }

    videos.push({
      messageId: String(msgId),
      caption: (msg as any).message || null,
      date: new Date(Number((msg as any).date) * 1000),
      documentId: String(doc.id),
      fileSize: Number(doc.size) || 0,
      mimeType,
      duration,
      width,
      height,
      fileName,
    });
  }

  return { videos, maxMessageId: String(maxId) };
}

// ── Graceful shutdown ───────────────────────────────────────────────────────

export async function shutdownMtProto(): Promise<void> {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  initPromise = null;
  if (client) {
    try {
      await client.disconnect();
      logger.info("[TELEGRAM] MTProto: disconnected (graceful shutdown)");
    } catch {
      // Ignore
    }
    client = null;
    connectionState = "disconnected";
  }
}
