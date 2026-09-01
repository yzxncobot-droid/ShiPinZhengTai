/**
 * Telegram video indexer — webhook-based, Bot API only.
 *
 * No GramJS, no MTProto, no message history scanning. Videos arrive via:
 *   1. Bot is a member of a group/channel → receives new video messages
 *   2. Admin forwards old videos to the bot → import via forward
 *
 * Flow: Webhook → extract metadata → import log (pending) → queue processor
 * → upsert video (duplicate-protected) → update log (completed/failed)
 *
 * The queue processor runs in the background with retry + exponential backoff.
 */
import { db } from "@workspace/db";
import {
  telegramSourcesTable, telegramVideosTable, telegramImportLogsTable,
} from "@workspace/db";
import { eq, and, sql, inArray } from "drizzle-orm";
import { logger } from "../logger";
import { sendMessage, isTelegramConfigured } from "./client";

// ── Types ────────────────────────────────────────────────────────────────────

export interface VideoMetadata {
  fileId: string;
  fileUniqueId: string;
  fileName: string | null;
  mimeType: string;
  fileSize: number;
  duration: number | null;
  width: number | null;
  height: number | null;
  caption: string | null;
  telegramDate: string; // ISO string
  telegramMessageId: string;
  effectiveChatId: string;
  sourceId: string;
  /** Chat ID where the bot received the message — used to reply to the user. */
  replyChatId: string;
  /** Telegram update_id for audit logging. */
  updateId: number | null;
  /** Whether the message was forwarded from another chat. */
  isForwarded: boolean;
  /** Original chat ID from forward_origin, if available. */
  forwardOriginChatId: string | null;
  /** Message type: VIDEO, ANIMATION, or DOCUMENT. */
  videoType: string;
}

export interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  total: number;
}

// ── Metadata extraction ─────────────────────────────────────────────────────

/**
 * Extract video metadata from a Telegram Bot API update.
 * Returns null for non-video messages.
 */
export function extractVideoMetadata(update: any): Omit<VideoMetadata, "sourceId"> | null {
  const message = update.message || update.channel_post ||
    update.edited_message || update.edited_channel_post;
  if (!message) return null;

  // Check for video, animation (GIF), or document with video mime type.
  const video = message.video || message.animation;
  if (!video) return null;

  const videoType = message.video ? "VIDEO" : message.animation ? "ANIMATION" : "DOCUMENT";

  // Determine the effective chat ID (where the video originally lives).
  let effectiveChatId = "";
  let forwardOriginChatId: string | null = null;

  // For forwarded messages, prefer the forward origin chat ID.
  if (message.forward_origin) {
    const origin = message.forward_origin;
    if ((origin.type === "channel" || origin.type === "chat") && origin.chat) {
      effectiveChatId = String(origin.chat.id);
      forwardOriginChatId = effectiveChatId;
    }
  }

  // Fall back to the message's own chat ID.
  if (!effectiveChatId && message.chat) {
    effectiveChatId = String(message.chat.id);
  }

  if (!effectiveChatId) return null;

  // replyChatId is always the chat where the bot received the message.
  const replyChatId = message.chat ? String(message.chat.id) : effectiveChatId;

  return {
    fileId: video.file_id || "",
    fileUniqueId: video.file_unique_id || "",
    fileName: video.file_name || null,
    mimeType: video.mime_type || "video/mp4",
    fileSize: Number(video.file_size) || 0,
    duration: video.duration ? Number(video.duration) : null,
    width: video.width ? Number(video.width) : null,
    height: video.height ? Number(video.height) : null,
    caption: message.caption || null,
    telegramDate: new Date(message.date * 1000).toISOString(),
    telegramMessageId: String(message.message_id),
    effectiveChatId,
    replyChatId,
    updateId: update.update_id ?? null,
    isForwarded: !!message.forward_origin,
    forwardOriginChatId,
    videoType,
  };
}

/**
 * Detect if an update is a text command (e.g. /start) that the bot should
 * respond to. Returns the message + text, or null for non-text updates.
 */
export function extractTextMessage(update: any): { chatId: string; text: string; messageId: string } | null {
  const message = update.message || update.channel_post;
  if (!message?.text && !message?.caption) return null;
  const text = message.text || message.caption || "";
  if (!text.startsWith("/")) return null;
  return {
    chatId: String(message.chat?.id || ""),
    text,
    messageId: String(message.message_id),
  };
}

// ── Source matching ──────────────────────────────────────────────────────────

/**
 * Result of source matching: either a source was found/created, or the chat
 * is not registered (and should be rejected with a clear message).
 */
interface SourceMatchResult {
  sourceId: string | null;
  /** When null, the chat is not registered and `rejectChatId` holds the ID. */
  rejectChatId: string | null;
  /** Whether a new "Manual Import" source was auto-created. */
  autoCreated: boolean;
  /** Whether the matched source is disabled. */
  disabled: boolean;
}

/**
 * Find a registered source by chat ID.
 *
 * - If a registered source is found → use it.
 * - If NOT found and the chat ID is a private chat (positive number, i.e. a
 *   direct send to the bot) → auto-create a "Manual Import" source.
 * - If NOT found and the chat ID is a group/channel (negative number) →
 *   reject: return rejectChatId so the caller can log + reply to the user.
 */
async function matchSource(chatId: string): Promise<SourceMatchResult> {
  // 1. Try to find an existing registered source with this chat ID.
  const [existing] = await db.select().from(telegramSourcesTable)
    .where(eq(telegramSourcesTable.chatId, chatId)).limit(1);

  if (existing) {
    return {
      sourceId: existing.id,
      rejectChatId: existing.enabled ? null : chatId,
      autoCreated: false,
      disabled: !existing.enabled,
    };
  }

  // 2. Private chat (positive number) → auto-create a "Manual Import" source.
  //    This handles direct video sends to the bot (Test 2/3).
  const isPrivateChat = !chatId.startsWith("-");
  if (isPrivateChat) {
    const [source] = await db.insert(telegramSourcesTable).values({
      name: "Manual Import",
      chatId,
      type: "GROUP",
      description: "Auto-created from direct video send to bot",
      enabled: true,
      status: "UNKNOWN",
    }).returning();
    logger.info({ sourceId: source.id, chatId }, "[TELEGRAM] Auto-created Manual Import source");
    return { sourceId: source.id, rejectChatId: null, autoCreated: true, disabled: false };
  }

  // 3. Group/channel not registered → reject.
  return { sourceId: null, rejectChatId: chatId, autoCreated: false, disabled: false };
}

// ── Webhook entry point ───────────────────────────────────────────────────────

/**
 * Process an incoming webhook update from Telegram.
 * Extracts video metadata, creates an import log entry (pending), and returns.
 * The queue processor handles the actual video upsert asynchronously.
 *
 * Deduplication: if a pending/processing entry already exists for the same
 * source + message, skip (Telegram retries updates if 200 is slow).
 */
export async function processIncomingUpdate(update: any): Promise<{ processed: boolean; reason?: string }> {
  // ── Handle text commands (e.g. /start) ────────────────────────────────────
  const textMsg = extractTextMessage(update);
  if (textMsg) {
    if (isTelegramConfigured()) {
      const command = textMsg.text.split(/\s+/)[0].toLowerCase();
      if (command === "/start") {
        await sendMessage(textMsg.chatId,
          "👋 Halo! Saya adalah bot untuk mengindex video.\n\n" +
          "Kirim atau forward video ke saya, dan video akan otomatis muncul di website.\n\n" +
          "Untuk import video lama, forward video dari group/channel ke bot ini.");
      }
    }
    return { processed: true, reason: "command" };
  }

  // ── Handle video messages ──────────────────────────────────────────────────
  const metadata = extractVideoMetadata(update);
  if (!metadata) return { processed: false, reason: "no_video" };

  try {
    // Match the source by effective chat ID.
    const match = await matchSource(metadata.effectiveChatId);

    // ── Source not registered (group/channel not in admin list) ─────────────
    if (match.sourceId === null && match.rejectChatId) {
      logger.warn(
        { chatId: match.rejectChatId, messageId: metadata.telegramMessageId },
        "[TELEGRAM] ⚠️ Source not registered",
      );

      // Create a failed import log so the admin can see the unregistered chat ID.
      // Set attempts to max so the queue processor does NOT retry this entry.
      await db.insert(telegramImportLogsTable).values({
        telegramSourceId: null,
        telegramMessageId: metadata.telegramMessageId,
        status: "failed",
        errorMessage: `Source not registered (Chat ID: ${match.rejectChatId})`,
        attempts: 999,
        metadata: JSON.stringify({ ...metadata, sourceId: null, rejectChatId: match.rejectChatId }),
      }).catch(() => {});

      // Reply to the user with the unregistered chat ID.
      if (isTelegramConfigured()) {
        await sendMessage(metadata.replyChatId,
          `❌ Source tidak terdaftar.\n\n` +
          `Chat ID: ${match.rejectChatId}\n\n` +
          `Admin perlu menambahkan Chat ID ini di Telegram Video Storage → Add Source.`);
      }
      return { processed: false, reason: "source_not_registered" };
    }

    // ── Source found but disabled ─────────────────────────────────────────────
    if (match.disabled && match.sourceId) {
      logger.warn(
        { sourceId: match.sourceId, chatId: metadata.effectiveChatId },
        "[TELEGRAM] Source disabled",
      );

      await db.insert(telegramImportLogsTable).values({
        telegramSourceId: match.sourceId,
        telegramMessageId: metadata.telegramMessageId,
        status: "failed",
        errorMessage: "Source is disabled",
        attempts: 999,
        metadata: JSON.stringify({ ...metadata, sourceId: match.sourceId }),
      }).catch(() => {});

      if (isTelegramConfigured()) {
        await sendMessage(metadata.replyChatId,
          "❌ Source ini sedang dinonaktifkan oleh admin.");
      }
      return { processed: false, reason: "source_disabled" };
    }

    const sourceId = match.sourceId!;

    // ── Duplicate check (Telegram retry protection) ──────────────────────────
    const [existing] = await db.select({ id: telegramImportLogsTable.id })
      .from(telegramImportLogsTable)
      .where(and(
        eq(telegramImportLogsTable.telegramSourceId, sourceId),
        eq(telegramImportLogsTable.telegramMessageId, metadata.telegramMessageId),
        inArray(telegramImportLogsTable.status, ["pending", "processing", "completed"]),
      ))
      .limit(1);

    if (existing) {
      return { processed: false, reason: "duplicate" };
    }

    // ── Create import log entry (pending) ─────────────────────────────────────
    await db.insert(telegramImportLogsTable).values({
      telegramSourceId: sourceId,
      telegramMessageId: metadata.telegramMessageId,
      status: "pending",
      metadata: JSON.stringify({ ...metadata, sourceId }),
    });

    logger.info(
      { chatId: metadata.effectiveChatId, messageId: metadata.telegramMessageId, sourceId },
      "[TELEGRAM] Import queued",
    );

    // ── Send immediate bot reply: "Video diterima, processing..." ─────────────
    if (isTelegramConfigured()) {
      const title = metadata.caption || metadata.fileName || "Video";
      const sizeStr = metadata.fileSize > 0
        ? formatBytes(metadata.fileSize)
        : "Unknown";
      await sendMessage(metadata.replyChatId,
        `✅ Video diterima\n\nJudul: ${title}\nUkuran: ${sizeStr}\nStatus: Processing...`,
      );
    }

    return { processed: true };
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "[TELEGRAM] processIncomingUpdate failed",
    );
    return { processed: false, reason: "error" };
  }
}

/** Format bytes into a human-readable string. */
function formatBytes(bytes: number): string {
  if (!bytes) return "Unknown";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ── Queue processor ──────────────────────────────────────────────────────────

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 10;
const POLL_INTERVAL_MS = 5000;

function getBackoffMs(attempts: number): number {
  return Math.min(1000 * Math.pow(2, attempts), 60000);
}

/**
 * Process a single import log entry: upsert the video metadata into the DB.
 * Duplicate protection: (telegramSourceId, telegramMessageId) unique index.
 */
async function processQueueItem(log: typeof telegramImportLogsTable.$inferSelect): Promise<void> {
  // Mark as processing.
  await db.update(telegramImportLogsTable).set({
    status: "processing",
    attempts: log.attempts + 1,
    processedAt: new Date(),
  }).where(eq(telegramImportLogsTable.id, log.id));

  try {
    const metadata = JSON.parse(log.metadata || "{}") as VideoMetadata;

    // Upsert: if (sourceId, messageId) exists → update, else → insert.
    const [existing] = await db.select({ id: telegramVideosTable.id })
      .from(telegramVideosTable)
      .where(and(
        eq(telegramVideosTable.telegramSourceId, metadata.sourceId),
        eq(telegramVideosTable.telegramMessageId, metadata.telegramMessageId),
      ))
      .limit(1);

    const videoData = {
      telegramFileId: metadata.fileId,
      fileName: metadata.fileName,
      title: metadata.caption || metadata.fileName || `Video ${metadata.telegramMessageId}`,
      mimeType: metadata.mimeType,
      fileSize: metadata.fileSize || null,
      duration: metadata.duration,
      width: metadata.width,
      height: metadata.height,
      caption: metadata.caption,
      telegramDate: new Date(metadata.telegramDate),
      updatedAt: new Date(),
    };

    if (existing) {
      await db.update(telegramVideosTable).set(videoData)
        .where(eq(telegramVideosTable.id, existing.id));
      logger.info({ videoId: existing.id }, "[TELEGRAM] Video updated (duplicate protection)");
    } else {
      await db.insert(telegramVideosTable).values({
        telegramSourceId: metadata.sourceId,
        telegramChatId: metadata.effectiveChatId,
        telegramMessageId: metadata.telegramMessageId,
        ...videoData,
      });
      logger.info({ sourceId: metadata.sourceId, messageId: metadata.telegramMessageId }, "[TELEGRAM] Video indexed");
    }

    // Update video count on the source.
    await db.update(telegramSourcesTable).set({
      videoCount: sql`(SELECT count(*)::int FROM telegram_videos WHERE telegram_source_id = ${metadata.sourceId})`,
      lastSyncAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(telegramSourcesTable.id, metadata.sourceId));

    // Mark as completed.
    await db.update(telegramImportLogsTable).set({
      status: "completed",
      processedAt: new Date(),
    }).where(eq(telegramImportLogsTable.id, log.id));

    // ── Send success reply to the user ───────────────────────────────────────
    if (isTelegramConfigured() && metadata.replyChatId) {
      const title = metadata.caption || metadata.fileName || `Video ${metadata.telegramMessageId}`;
      await sendMessage(metadata.replyChatId,
        `✅ Video berhasil ditambahkan ke website.\n\nJudul: ${title}`,
      ).catch(() => {});
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message.substring(0, 500) : "Unknown error";
    logger.error({ err: errMsg, logId: log.id }, "[TELEGRAM] Queue item failed");

    const attempts = log.attempts + 1;

    await db.update(telegramImportLogsTable).set({
      status: attempts >= MAX_ATTEMPTS ? "failed" : "failed",
      errorMessage: errMsg,
      processedAt: new Date(),
    }).where(eq(telegramImportLogsTable.id, log.id));

    // ── Send failure reply to the user (only on final failure) ────────────────
    if (attempts >= MAX_ATTEMPTS && isTelegramConfigured() && metadata.replyChatId) {
      await sendMessage(metadata.replyChatId,
        "❌ Video gagal diproses.\n\nSilakan cek Telegram Video Storage → Logs.",
      ).catch(() => {});
    }
  }
}

let queueTimer: ReturnType<typeof setInterval> | null = null;

/** Start the background queue processor. Call once on module load. */
export function startQueueProcessor(): void {
  if (queueTimer) return;

  queueTimer = setInterval(async () => {
    try {
      // Pick up pending entries + failed entries past their backoff window.
      const now = new Date();
      const entries = await db.select()
        .from(telegramImportLogsTable)
        .where(
          and(
            inArray(telegramImportLogsTable.status, ["pending", "failed"]),
          ),
        )
        .orderBy(telegramImportLogsTable.createdAt)
        .limit(BATCH_SIZE);

      for (const entry of entries) {
        // Skip rejected entries (null source = unregistered/disabled).
        if (!entry.telegramSourceId) continue;
        // For failed entries, check backoff.
        if (entry.status === "failed" && entry.attempts >= MAX_ATTEMPTS) continue;
        if (entry.status === "failed" && entry.processedAt) {
          const backoff = getBackoffMs(entry.attempts);
          const eligibleAt = new Date(entry.processedAt.getTime() + backoff);
          if (eligibleAt > now) continue;
        }

        try {
          await processQueueItem(entry);
        } catch (err) {
          // Error already logged in processQueueItem — continue with next.
        }
      }
    } catch (err) {
      logger.error({ err }, "[TELEGRAM] Queue processor error");
    }
  }, POLL_INTERVAL_MS);

  logger.info(`[TELEGRAM] Queue processor started (interval: ${POLL_INTERVAL_MS / 1000}s)`);
}

// ── Queue stats ─────────────────────────────────────────────────────────────

export async function getQueueStats(): Promise<QueueStats> {
  const [stats] = await db.select({
    pending: sql<number>`count(*) filter (where ${telegramImportLogsTable.status} = 'pending')::int`,
    processing: sql<number>`count(*) filter (where ${telegramImportLogsTable.status} = 'processing')::int`,
    completed: sql<number>`count(*) filter (where ${telegramImportLogsTable.status} = 'completed')::int`,
    failed: sql<number>`count(*) filter (where ${telegramImportLogsTable.status} = 'failed')::int`,
    total: sql<number>`count(*)::int`,
  }).from(telegramImportLogsTable);
  return stats;
}

// ── Retry a failed import ────────────────────────────────────────────────────

export async function retryImportLog(logId: string): Promise<void> {
  await db.update(telegramImportLogsTable).set({
    status: "pending",
    errorMessage: null,
    processedAt: null,
  }).where(eq(telegramImportLogsTable.id, logId));
}

// ── Sync source (Bot API: just test connection + update status) ──────────────

/**
 * With Bot API only, "sync" means: test the connection and update the
 * source status + video count. There is no message history scanning.
 */
export async function syncSource(sourceId: string): Promise<{ connected: boolean; videoCount: number }> {
  const [source] = await db.select().from(telegramSourcesTable)
    .where(eq(telegramSourcesTable.id, sourceId)).limit(1);
  if (!source) throw new Error("Source not found");

  // Update video count.
  const [{ count: videoCount }] = await db.select({
    count: sql<number>`count(*)::int`,
  }).from(telegramVideosTable)
    .where(eq(telegramVideosTable.telegramSourceId, sourceId));

  await db.update(telegramSourcesTable).set({
    videoCount,
    lastSyncAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(telegramSourcesTable.id, sourceId));

  return { connected: source.status === "CONNECTED", videoCount };
}
