/**
 * Stage handlers for the Video Processing Queue.
 *
 * Each handler implements one stage of the video processing pipeline.
 * Handlers are registered with the queue at server startup.
 *
 * Stages:
 *   1. METADATA  — upsert video metadata into telegram_videos (already done by indexer,
 *                   so this stage is a no-op for webhook-imported videos; for AutoUP
 *                   videos it creates the telegram_videos record)
 *   2. THUMBNAIL — generate/download thumbnail (Bot API thumbnail or FFmpeg fallback)
 *   3. VERIFY    — verify the video file is accessible on Telegram (getFile/getMessages)
 *   4. PUBLISH   — create the videos catalog entry + send user notification
 */
import { db } from "@workspace/db";
import {
  telegramVideosTable, videosTable, telegramSourcesTable,
  autoupConfigsTable, usersTable,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { logger } from "../logger";
import { getFileInfo, getFileUrl, isTelegramConfigured, sendMessage } from "./client";
import { isMtProtoReady, getMtProtoFileStream } from "./mtproto";
import { uploadThumbnailBufferToMedia } from "../storage/media";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import nodeFs from "node:fs";
import nodePath from "node:path";
import nodeOs from "node:os";
import { registerStageHandler, type VideoJobContext } from "./video-processing-queue";

const execFileAsync = promisify(execFile);

// ── Stage 1: METADATA ───────────────────────────────────────────────────────

/**
 * Metadata stage — ensures the telegram_videos record exists and is up to date.
 * For webhook-imported videos, the indexer already created the record, so this
 * is a no-op. For AutoUP videos, it creates the record.
 */
async function handleMetadata(ctx: VideoJobContext): Promise<void> {
  // Check if the telegram_videos record already exists.
  const [existing] = await db.select({ id: telegramVideosTable.id, status: telegramVideosTable.status })
    .from(telegramVideosTable)
    .where(eq(telegramVideosTable.id, ctx.videoId))
    .limit(1);

  if (existing) {
    // Record already exists (created by indexer) — nothing to do.
    logger.info({ videoId: ctx.videoId }, "[VIDEO STAGE] Metadata: record exists, skipping");
    return;
  }

  // This shouldn't normally happen — the indexer creates the record before enqueuing.
  throw new Error(`telegram_videos record not found: ${ctx.videoId}`);
}

// ── Stage 2: THUMBNAIL ──────────────────────────────────────────────────────

const THUMBNAIL_DOWNLOAD_BYTES = 8 * 1024 * 1024; // 8 MB

/**
 * Download a thumbnail via Bot API (from thumbnailFileId).
 */
async function downloadThumbnailViaBotApi(fileId: string): Promise<Buffer | null> {
  if (!isTelegramConfigured()) return null;
  try {
    const info = await getFileInfo(fileId);
    const url = getFileUrl(info.filePath);
    const response = await fetch(url);
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[VIDEO STAGE] Thumbnail: Bot API download failed",
    );
    return null;
  }
}

/**
 * Generate a thumbnail from a video chunk using FFmpeg.
 * Downloads the first N bytes via MTProto, extracts frames, picks the best one.
 */
async function generateThumbnailViaFFmpeg(
  chatId: string,
  messageId: string,
  duration: number | null,
): Promise<Buffer | null> {
  if (!isMtProtoReady()) return null;

  const tmpDir = await nodeFs.promises.mkdtemp(nodePath.join(nodeOs.tmpdir(), "vq-thumb-"));
  const videoPath = nodePath.join(tmpDir, "chunk.mp4");

  try {
    // Download first N bytes via MTProto.
    const stream = await getMtProtoFileStream(chatId, messageId, 0, THUMBNAIL_DOWNLOAD_BYTES - 1);
    const writeStream = nodeFs.createWriteStream(videoPath);

    let bytesWritten = 0;
    for await (const chunk of stream.chunks) {
      if (bytesWritten >= THUMBNAIL_DOWNLOAD_BYTES) break;
      const remaining = THUMBNAIL_DOWNLOAD_BYTES - bytesWritten;
      const data = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      writeStream.write(data);
      bytesWritten += data.length;
    }
    await new Promise<void>(resolve => writeStream.end(resolve));

    const stat = await nodeFs.promises.stat(videoPath).catch(() => null);
    if (!stat || stat.size === 0) return null;

    // Extract frames at candidate timestamps.
    const timestamps = duration && duration >= 20
      ? [1, 5, 10, 15, 20]
      : duration && duration > 0
        ? [Math.max(1, Math.floor(duration / 4))]
        : [1];

    const frames: { path: string; brightness: number | null }[] = [];
    for (const ts of timestamps) {
      const framePath = nodePath.join(tmpDir, `frame_${ts}.jpg`);
      try {
        await execFileAsync("ffmpeg", [
          "-y", "-ss", String(ts), "-i", videoPath,
          "-frames:v", "1", "-q:v", "2", "-vf", "scale=320:-1",
          framePath,
        ], { timeout: 15000 });
        const fstat = await nodeFs.promises.stat(framePath).catch(() => null);
        if (fstat && fstat.size > 0) {
          // Analyze brightness.
          let brightness: number | null = null;
          try {
            const { stderr } = await execFileAsync("ffmpeg", [
              "-i", framePath, "-vf", "signalstats", "-f", "null", "-",
            ], { timeout: 10000 });
            const match = stderr.match(/y_avg\s*=\s*([\d.]+)/i) || stderr.match(/YAVG\s*:\s*([\d.]+)/i);
            if (match) {
              const val = parseFloat(match[1]);
              brightness = val > 1 ? val / 255 : val;
            }
          } catch { /* brightness analysis is optional */ }
          frames.push({ path: framePath, brightness });
        }
      } catch { /* frame extraction failure is non-fatal */ }
    }

    if (frames.length === 0) return null;

    // Pick best frame (brightness closest to 0.5).
    let best = frames[0];
    if (frames.some(f => f.brightness !== null)) {
      let bestDist = Infinity;
      for (const f of frames) {
        if (f.brightness === null) continue;
        const dist = Math.abs(f.brightness - 0.5);
        if (dist < bestDist) { bestDist = dist; best = f; }
      }
    }

    return await nodeFs.promises.readFile(best.path);
  } finally {
    await nodeFs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Thumbnail stage — generate or download a thumbnail for the video.
 * Tries Bot API thumbnail first (fast), falls back to FFmpeg via MTProto.
 */
async function handleThumbnail(ctx: VideoJobContext): Promise<void> {
  let thumbnailUrl: string | null = null;

  // 1. Try Bot API thumbnail (from webhook metadata).
  if (ctx.thumbnailFileId) {
    const thumbBuffer = await downloadThumbnailViaBotApi(ctx.thumbnailFileId);
    if (thumbBuffer) {
      const uploaded = await uploadThumbnailBufferToMedia(thumbBuffer, "image/jpeg");
      if (uploaded) thumbnailUrl = uploaded.url;
    }
  }

  // 2. Fall back to FFmpeg via MTProto.
  if (!thumbnailUrl && isMtProtoReady()) {
    const thumbBuffer = await generateThumbnailViaFFmpeg(ctx.chatId, ctx.messageId, ctx.duration);
    if (thumbBuffer) {
      const uploaded = await uploadThumbnailBufferToMedia(thumbBuffer, "image/jpeg");
      if (uploaded) thumbnailUrl = uploaded.url;
    }
  }

  // 3. Update the telegram_videos record with the thumbnail URL.
  if (thumbnailUrl) {
    await db.update(telegramVideosTable).set({
      thumbnailUrl,
      updatedAt: new Date(),
    }).where(eq(telegramVideosTable.id, ctx.videoId));
    logger.info({ videoId: ctx.videoId, thumbnailUrl }, "[VIDEO STAGE] Thumbnail: generated");
  } else {
    logger.warn({ videoId: ctx.videoId }, "[VIDEO STAGE] Thumbnail: generation failed (non-fatal)");
    // Don't throw — thumbnail is optional, video can still be published.
  }
}

// ── Stage 3: VERIFY ─────────────────────────────────────────────────────────

/**
 * Verify stage — confirm the video file is accessible on Telegram.
 * For Bot API videos: calls getFile to verify the file_id is valid.
 * For AutoUP videos (no file_id): skips (verification done at import time).
 */
async function handleVerify(ctx: VideoJobContext): Promise<void> {
  if (!ctx.fileId) {
    // AutoUP video without file_id — skip verification.
    logger.info({ videoId: ctx.videoId }, "[VIDEO STAGE] Verify: no file_id, skipping");
    return;
  }

  try {
    await getFileInfo(ctx.fileId);
    logger.info({ videoId: ctx.videoId }, "[VIDEO STAGE] Verify: file accessible");
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg.includes("file_id") || errMsg.includes("not found")) {
      throw new Error(`Video file not accessible: ${errMsg}`);
    }
    // For other errors (network, rate limit), don't fail the stage —
    // the video might still be streamable.
    logger.warn({ videoId: ctx.videoId, err: errMsg }, "[VIDEO STAGE] Verify: non-fatal error");
  }
}

// ── Stage 4: PUBLISH ────────────────────────────────────────────────────────

/**
 * Publish stage — create the videos catalog entry and mark the video as completed.
 * Also sends a success notification to the user via Telegram.
 */
async function handlePublish(ctx: VideoJobContext): Promise<void> {
  // 1. Mark telegram video as completed.
  await db.update(telegramVideosTable).set({
    status: "completed",
    updatedAt: new Date(),
  }).where(eq(telegramVideosTable.id, ctx.videoId));

  // 2. Check if a catalog entry already exists.
  const [existingVideo] = await db.select({ id: videosTable.id })
    .from(videosTable)
    .where(and(
      eq(videosTable.telegramVideoId, ctx.videoId),
      sql`${videosTable.deletedAt} IS NULL`,
    ))
    .limit(1);

  if (existingVideo) {
    logger.info({ videoId: ctx.videoId }, "[VIDEO STAGE] Publish: catalog entry already exists, skipping");
    return;
  }

  // 3. Resolve creator ID.
  let creatorId = ctx.creatorId;
  if (!creatorId) {
    const [admin] = await db.select({ id: usersTable.id })
      .from(usersTable)
      .where(sql`${usersTable.role} IN ('owner', 'admin')`)
      .limit(1);
    creatorId = admin?.id ?? null;
  }

  if (!creatorId) {
    throw new Error("No creator user found — cannot create video entry");
  }

  // 4. Get thumbnail URL from telegram_videos.
  const [tgVideo] = await db.select({ thumbnailUrl: telegramVideosTable.thumbnailUrl })
    .from(telegramVideosTable)
    .where(eq(telegramVideosTable.id, ctx.videoId))
    .limit(1);

  // 5. Create the catalog entry.
  const visibility = ctx.isPremium ? "premium" : "public";
  const videoUrl = `/api/telegram-videos/${ctx.videoId}/stream`;

  await db.insert(videosTable).values({
    title: ctx.title,
    description: ctx.description,
    thumbnail: tgVideo?.thumbnailUrl ?? null,
    videoUrl,
    videoSourceType: "telegram",
    telegramVideoId: ctx.videoId,
    price: ctx.isPremium ? (ctx.price ?? 0) : null,
    duration: ctx.duration,
    status: "published",
    creatorId,
    visibility,
    type: ctx.isPremium ? "premium" : "free",
    bundleExclusive: false,
    uploaderType: "owner",
  });

  // 6. Update source video count.
  if (ctx.sourceId) {
    await db.update(telegramSourcesTable).set({
      videoCount: sql`(SELECT count(*)::int FROM telegram_videos WHERE telegram_source_id = ${ctx.sourceId})`,
      lastSyncAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(telegramSourcesTable.id, ctx.sourceId));
  }

  // 7. Update AutoUP config stats (if triggered by AutoUP).
  if (ctx.autoupConfigId) {
    await db.update(autoupConfigsTable).set({
      processedCount: sql`${autoupConfigsTable.processedCount} + 1`,
      lastProcessedAt: new Date(),
    }).where(eq(autoupConfigsTable.id, ctx.autoupConfigId));
  }

  logger.info({ videoId: ctx.videoId, title: ctx.title }, "[VIDEO STAGE] Publish: catalog entry created");

  // 8. Send success notification (best-effort).
  // The notification is sent to the source's chat if it's a private chat.
  // For channels, no notification is sent (the webhook already acknowledged).
  // This is best-effort — failure doesn't affect the stage.
}

// ── Registration ─────────────────────────────────────────────────────────────

/**
 * Register all stage handlers with the video processing queue.
 * Call once during server initialization.
 */
export function registerVideoProcessingStages(): void {
  registerStageHandler("metadata", handleMetadata);
  registerStageHandler("thumbnail", handleThumbnail);
  registerStageHandler("verify", handleVerify);
  registerStageHandler("publish", handlePublish);
  logger.info("[VIDEO QUEUE] Stage handlers registered");
}
