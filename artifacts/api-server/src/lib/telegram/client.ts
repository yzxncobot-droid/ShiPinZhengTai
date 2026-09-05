/**
 * Telegram Bot API client — HTTP-based, uses ONLY TELEGRAM_BOT_TOKEN.
 *
 * No MTProto, no GramJS, no API ID / API Hash / String Session.
 * All calls go to the Bot API endpoint (default: https://api.telegram.org).
 *
 * To support files larger than 20 MB, set TELEGRAM_API_BASE to a Telegram
 * Local Bot API Server URL (e.g. http://localhost:8081). This is a drop-in
 * replacement — same bot token, no extra credentials needed — and lifts the
 * getFile limit from 20 MB to 2 GB.
 *
 * The bot token is NEVER sent to the frontend, logged, or exposed in API
 * responses. It stays server-side in process.env.
 */
import { logger } from "../logger";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
/**
 * Configurable API base. Defaults to the public Telegram Bot API.
 * Set TELEGRAM_API_BASE to a Local Bot API Server URL for large-file support.
 */
const TELEGRAM_API_BASE = process.env.TELEGRAM_API_BASE || "https://api.telegram.org";
const API_BASE = `${TELEGRAM_API_BASE}/bot${BOT_TOKEN}`;
const FILE_BASE = `${TELEGRAM_API_BASE}/file/bot${BOT_TOKEN}`;

export function isTelegramConfigured(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN;
}

/**
 * Returns true when a Local Bot API Server is *configured* (TELEGRAM_API_BASE
 * is set). This only checks configuration — it does NOT prove the server is
 * actually reachable. Use checkLocalBotApiHealth() for a real connection test.
 */
export function isLocalBotApiConfigured(): boolean {
  return !!process.env.TELEGRAM_API_BASE;
}

/**
 * Performs a real connection test against the configured Local Bot API Server
 * via a lightweight getMe call. Returns true only if the server responds with a
 * valid Bot API result. Never logs the bot token.
 *
 * Do NOT use ENV existence as proof the server is active — the server may be
 * configured but down, misconfigured, or unreachable.
 */
export async function checkLocalBotApiHealth(): Promise<boolean> {
  if (!isLocalBotApiConfigured()) return false;
  try {
    await botApiCall<{ id: number }>("getMe");
    return true;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[TELEGRAM] Local Bot API Server health check failed",
    );
    return false;
  }
}

/** @deprecated Use isLocalBotApiConfigured() (config) or checkLocalBotApiHealth() (reachable). */
export function isLocalBotApiServer(): boolean {
  return isLocalBotApiConfigured();
}

/** Telegram Bot API error. */
export class TelegramBotApiError extends Error {
  errorCode: number;
  constructor(description: string, errorCode: number) {
    super(description);
    this.name = "TelegramBotApiError";
    this.errorCode = errorCode;
  }
}

/**
 * Generic Bot API call. Returns `result` on success, throws on error.
 * Never logs the bot token or request body (may contain file_id).
 */
export async function botApiCall<T = any>(
  method: string,
  params?: Record<string, any>,
): Promise<T> {
  if (!isTelegramConfigured()) {
    throw new Error("Telegram bot token not configured");
  }

  const url = `${API_BASE}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params ?? {}),
  });

  const data: any = await res.json().catch(() => null);
  if (!data) {
    throw new Error(`Telegram API returned non-JSON (HTTP ${res.status})`);
  }

  if (!data.ok) {
    throw new TelegramBotApiError(
      data.description || `Telegram API error: ${data.error_code}`,
      data.error_code || res.status,
    );
  }

  return data.result as T;
}

// ── Bot info ─────────────────────────────────────────────────────────────────

interface BotInfo {
  id: number;
  username: string;
  firstName: string;
}

let cachedBotInfo: BotInfo | null = null;

export async function getBotInfo(): Promise<BotInfo | null> {
  if (cachedBotInfo) return cachedBotInfo;
  if (!isTelegramConfigured()) return null;
  try {
    const me = await botApiCall<BotInfo>("getMe");
    cachedBotInfo = me;
    logger.info({ username: me.username }, "[TELEGRAM] Bot info retrieved");
    return me;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[TELEGRAM] getMe failed");
    return null;
  }
}

// ── Connection test ─────────────────────────────────────────────────────────

export interface ConnectionTestResult {
  success: boolean;
  title?: string;
  type?: string;
  chatId?: string;
  errorMessage?: string;
}

/** Sanitize an error message — never expose tokens, hashes, or secrets. */
function sanitizeError(message: string): string {
  return message
    .replace(/bot\d+:[\w-]+/gi, "***") // bot tokens
    .replace(/[A-Za-z0-9_-]{30,}/g, "***") // long secrets
    .substring(0, 500);
}

/**
 * Test whether the bot can access a given chat via Bot API `getChat`.
 * Returns the chat title and type on success, or a sanitized error message.
 */
export async function testConnection(chatId: string): Promise<ConnectionTestResult> {
  try {
    if (!isTelegramConfigured()) {
      return { success: false, errorMessage: "TELEGRAM_BOT_TOKEN not configured" };
    }

    const chat = await botApiCall<{
      id: number;
      title?: string;
      type: string;
      username?: string;
      first_name?: string;
    }>("getChat", { chat_id: chatId });

    const title = chat.title || chat.first_name || chat.username || "Unknown";
    const type = chat.type === "channel" ? "CHANNEL" : "GROUP";

    logger.info({ chatId, title, type }, "[TELEGRAM] Connection test succeeded");
    return { success: true, title, type, chatId: String(chat.id) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const safe = sanitizeError(message);
    logger.warn({ chatId, err: safe }, "[TELEGRAM] Connection test failed");
    return { success: false, errorMessage: safe || "Bot does not have access to this chat" };
  }
}

// ── File download ───────────────────────────────────────────────────────────

export interface TelegramFileInfo {
  fileId: string;
  fileUniqueId: string;
  fileSize: number;
  filePath: string;
}

/**
 * Get the file path for a file_id via Bot API `getFile`.
 *
 * With the standard Bot API (api.telegram.org): 20 MB limit (Telegram-imposed).
 * With a Local Bot API Server (TELEGRAM_API_BASE set): up to 2 GB.
 * The limit is determined by Telegram/infrastructure, not by this code.
 */
export async function getFileInfo(fileId: string): Promise<TelegramFileInfo> {
  const result = await botApiCall<{
    file_id: string;
    file_unique_id: string;
    file_size: number;
    file_path: string;
  }>("getFile", { file_id: fileId });

  return {
    fileId: result.file_id,
    fileUniqueId: result.file_unique_id,
    fileSize: result.file_size,
    filePath: result.file_path,
  };
}

/** Construct the download URL for a file_path returned by getFile. */
export function getFileUrl(filePath: string): string {
  return `${FILE_BASE}/${filePath}`;
}

// ── Webhook management ──────────────────────────────────────────────────────

export interface WebhookInfo {
  url: string;
  pendingUpdateCount: number;
  lastErrorDate?: number;
  lastErrorMessage?: string;
  maxConnections?: number;
  allowedUpdates?: string[];
  hasCustomCertificate?: boolean;
}

export async function setWebhook(url: string, secretToken?: string): Promise<boolean> {
  return botApiCall<boolean>("setWebhook", {
    url,
    ...(secretToken ? { secret_token: secretToken } : {}),
    allowed_updates: ["message", "channel_post", "edited_message", "edited_channel_post"],
  });
}

export async function getWebhookInfo(): Promise<WebhookInfo> {
  return botApiCall<WebhookInfo>("getWebhookInfo");
}

export async function deleteWebhook(): Promise<boolean> {
  return botApiCall<boolean>("deleteWebhook", { drop_pending_updates: true });
}

// ── Send message (bot reply to users) ────────────────────────────────────────

/**
 * Send a text message to a chat. Used by the webhook handler to reply to
 * users who send/forward videos to the bot. Never logs the bot token.
 */
export async function sendMessage(
  chatId: string | number,
  text: string,
  params?: Record<string, any>,
): Promise<boolean> {
  try {
    await botApiCall("sendMessage", {
      chat_id: chatId,
      text,
      ...params,
    });
    return true;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), chatId },
      "[TELEGRAM] sendMessage failed",
    );
    return false;
  }
}

// ── Message forwarding (for file_id refresh) ────────────────────────────────

/**
 * Forward a message to the bot's own chat to get a fresh file_id.
 * Returns the new file_id from the forwarded message.
 *
 * The caller is responsible for updating the correct database record
 * (by video ID), NOT by chat ID alone — refreshing one video's file_id
 * must not affect other videos from the same chat.
 */
export async function refreshFileId(
  fromChatId: string,
  messageId: string,
): Promise<string | null> {
  try {
    const botInfo = await getBotInfo();
    if (!botInfo) return null;

    const forwarded = await botApiCall<{
      message_id: number;
      video?: { file_id: string };
      animation?: { file_id: string };
      document?: { file_id: string };
    }>("forwardMessage", {
      chat_id: botInfo.id,
      from_chat_id: fromChatId,
      message_id: Number(messageId),
    });

    const fileId = forwarded.video?.file_id || forwarded.animation?.file_id || forwarded.document?.file_id;
    return fileId ?? null;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), fromChatId, messageId },
      "[TELEGRAM] refreshFileId failed",
    );
    return null;
  }
}
