/**
 * Telegram video indexer — scans channel/group messages, extracts video
 * metadata, and upserts it into the database. Supports initial sync (all
 * history) and incremental sync (new messages since last sync).
 *
 * Duplicate protection: (telegramSourceId, telegramMessageId) is a unique
 * index — re-syncing updates existing rows instead of creating duplicates.
 */
import { db } from "@workspace/db";
import {
  telegramSourcesTable, telegramVideosTable, telegramSyncLogsTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "../logger";
import { getTelegramClient, getTelegramApi, isTelegramConfigured } from "./client";

// Track which sources are currently syncing (in-memory).
const syncingSources = new Set<string>();

export function isSyncing(sourceId: string): boolean {
  return syncingSources.has(sourceId);
}

export interface SyncResult {
  newVideos: number;
  updatedVideos: number;
  skippedVideos: number;
  errorsCount: number;
  totalVideos: number;
}

/**
 * Sync a Telegram source: iterate its video messages and upsert metadata.
 *
 * syncType:
 *   "initial"    — scan ALL history
 *   "incremental" — only messages after lastSyncedMessageId
 *   "manual"      — same as initial (admin clicked "Sync Now")
 */
export async function syncSource(
  sourceId: string,
  syncType: "initial" | "incremental" | "manual" = "manual",
): Promise<SyncResult> {
  if (syncingSources.has(sourceId)) {
    throw new Error("Sync already in progress for this source");
  }

  syncingSources.add(sourceId);

  // Create a sync log entry.
  const [log] = await db.insert(telegramSyncLogsTable).values({
    telegramSourceId: sourceId,
    syncType,
    status: "in_progress",
  }).returning();

  // Mark source as syncing.
  await db.update(telegramSourcesTable).set({
    status: "SYNCING",
    updatedAt: new Date(),
  }).where(eq(telegramSourcesTable.id, sourceId));

  try {
    const client = await getTelegramClient();
    if (!client) throw new Error("Telegram credentials not configured");

    const [source] = await db.select().from(telegramSourcesTable)
      .where(eq(telegramSourcesTable.id, sourceId)).limit(1);
    if (!source) throw new Error("Source not found");

    // Resolve the chat entity.
    const entity = await client.getEntity(source.chatId);

    // Load existing message IDs for this source (for upsert decisions).
    const existing = await db.select({
      messageId: telegramVideosTable.telegramMessageId,
    }).from(telegramVideosTable)
      .where(eq(telegramVideosTable.telegramSourceId, sourceId));
    const existingSet = new Set(existing.map((r) => r.messageId));

    // Determine minId for incremental sync.
    const minId =
      syncType === "incremental" && source.lastSyncedMessageId
        ? Number(source.lastSyncedMessageId)
        : undefined;

    const Api = await getTelegramApi();

    let newCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    let highestMsgId = minId || 0;

    // Iterate all video messages in the chat.
    for await (const message of client.iterMessages(entity, {
      filter: new Api.InputMessagesFilterVideo(),
      ...(minId ? { minId } : {}),
    })) {
      try {
        if (!message.media || !message.media.document) {
          skippedCount++;
          continue;
        }

        const doc = message.media.document;
        const mimeType: string = doc.mimeType || "";

        // Only index video files.
        if (!mimeType.startsWith("video/")) {
          skippedCount++;
          continue;
        }

        // Extract metadata from document attributes.
        let fileName = "";
        let duration: number | null = null;
        let width: number | null = null;
        let height: number | null = null;

        for (const attr of (doc.attributes || [])) {
          if (attr.className === "DocumentAttributeFilename") {
            fileName = attr.fileName || "";
          }
          if (attr.className === "DocumentAttributeVideo") {
            duration = Number(attr.duration) || null;
            width = Number(attr.w) || null;
            height = Number(attr.h) || null;
          }
        }

        // Thumbnail reference.
        let thumbnailFileId: string | null = null;
        if (doc.thumbs && doc.thumbs.length > 0) {
          thumbnailFileId = String(doc.thumbs[0].type || "");
        }

        const msgId = String(message.id);
        if (message.id > highestMsgId) highestMsgId = message.id;

        const caption: string = message.message || "";
        const title: string = caption || fileName || `Video ${msgId}`;
        const fileSize: number = Number(doc.size) || 0;

        if (existingSet.has(msgId)) {
          // UPDATE existing row.
          await db.update(telegramVideosTable).set({
            telegramFileId: String(doc.id),
            fileName: fileName || null,
            title,
            mimeType,
            fileSize: fileSize || null,
            duration,
            width,
            height,
            thumbnailFileId,
            caption: caption || null,
            telegramDate: new Date(message.date * 1000),
            updatedAt: new Date(),
          }).where(
            sql`${telegramVideosTable.telegramSourceId} = ${sourceId}
               AND ${telegramVideosTable.telegramMessageId} = ${msgId}`,
          );
          updatedCount++;
        } else {
          // INSERT new row.
          await db.insert(telegramVideosTable).values({
            telegramSourceId: sourceId,
            telegramChatId: source.chatId,
            telegramMessageId: msgId,
            telegramFileId: String(doc.id),
            fileName: fileName || null,
            title,
            mimeType,
            fileSize: fileSize || null,
            duration,
            width,
            height,
            thumbnailFileId,
            caption: caption || null,
            telegramDate: new Date(message.date * 1000),
          });
          newCount++;
          existingSet.add(msgId);
        }
      } catch (err) {
        errorCount++;
        logger.error(
          { err: err instanceof Error ? err.message : String(err), messageId: message.id },
          "[TELEGRAM] Indexing error for message",
        );
      }
    }

    // Count total videos for this source.
    const [{ count: totalCount }] = await db.select({
      count: sql<number>`count(*)::int`,
    }).from(telegramVideosTable)
      .where(eq(telegramVideosTable.telegramSourceId, sourceId));

    // Update source with sync results.
    await db.update(telegramSourcesTable).set({
      status: "CONNECTED",
      lastSyncAt: new Date(),
      lastConnectionCheck: new Date(),
      videoCount: totalCount,
      lastSyncedMessageId: String(highestMsgId),
      errorMessage: null,
      updatedAt: new Date(),
    }).where(eq(telegramSourcesTable.id, sourceId));

    // Complete the sync log.
    await db.update(telegramSyncLogsTable).set({
      status: "success",
      newVideos: newCount,
      updatedVideos: updatedCount,
      skippedVideos: skippedCount,
      errorsCount: errorCount,
      completedAt: new Date(),
    }).where(eq(telegramSyncLogsTable.id, log.id));

    logger.info(
      { sourceId, newCount, updatedCount, skippedCount, errorCount, totalCount },
      "[TELEGRAM] Sync completed",
    );

    return {
      newVideos: newCount,
      updatedVideos: updatedCount,
      skippedVideos: skippedCount,
      errorsCount: errorCount,
      totalVideos: totalCount,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message.substring(0, 500) : "Unknown error";

    // Mark source as error.
    await db.update(telegramSourcesTable).set({
      status: "ERROR",
      errorMessage: errMsg,
      lastConnectionCheck: new Date(),
      updatedAt: new Date(),
    }).where(eq(telegramSourcesTable.id, sourceId));

    // Update sync log.
    await db.update(telegramSyncLogsTable).set({
      status: "error",
      errorMessage: errMsg,
      completedAt: new Date(),
    }).where(eq(telegramSyncLogsTable.id, log.id));

    logger.error({ err, sourceId }, "[TELEGRAM] Sync failed");
    throw err;
  } finally {
    syncingSources.delete(sourceId);
  }
}

// ── Automatic sync ──────────────────────────────────────────────────────────
// Periodic background task that incremental-syncs all enabled, connected sources.

let autoSyncTimer: ReturnType<typeof setInterval> | null = null;

export function startAutoSync(): void {
  const intervalMs = Number(process.env.TELEGRAM_SYNC_INTERVAL_MS) || 5 * 60 * 1000;

  if (autoSyncTimer) clearInterval(autoSyncTimer);

  autoSyncTimer = setInterval(async () => {
    if (!isTelegramConfigured()) return;

    try {
      const sources = await db.select().from(telegramSourcesTable)
        .where(eq(telegramSourcesTable.enabled, true));

      for (const source of sources) {
        if (syncingSources.has(source.id)) continue;
        if (source.status === "ERROR") continue;

        try {
          await syncSource(source.id, "incremental");
        } catch (err) {
          logger.error(
            { err: err instanceof Error ? err.message : String(err), sourceId: source.id },
            "[TELEGRAM] Auto sync error for source",
          );
        }
      }
    } catch (err) {
      logger.error({ err }, "[TELEGRAM] Auto sync loop error");
    }
  }, intervalMs);

  logger.info(`[TELEGRAM] Auto sync started (interval: ${intervalMs / 1000}s)`);
}
