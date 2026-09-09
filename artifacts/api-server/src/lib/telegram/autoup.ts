/**
 * AutoUP — automatic video import from Telegram sources.
 *
 * TWO detection paths:
 *
 * 1. WEBHOOK-TRIGGERED (primary for channels):
 *    When a video is forwarded to a channel, the Telegram webhook receives it
 *    in real-time. The webhook indexer (indexer.ts) creates a telegram_videos
 *    record and marks it "completed", then calls processVideoFromWebhook().
 *    This finds matching AutoUP configs and creates the videos catalog entry
 *    with the config's premium/price/description settings.
 *
 *    Bots cannot use messages.getHistory (MTProto polling) on channels —
 *    Telegram returns BOT_METHOD_INVALID. So webhook is the ONLY way to
 *    detect new videos in channels.
 *
 * 2. MTPROTO POLLING (fallback for groups):
 *    Polls each active AutoUP config's Telegram source for new video messages
 *    using the EXISTING MTProto singleton client. Works for groups where the
 *    bot has access. For each new video:
 *      1. Duplicate check (source + message ID)
 *      2. Extract metadata from the MTProto document
 *      3. Title = Telegram caption (cleaned), or "Video Baru" fallback
 *      4. Thumbnail = 1 frame via FFmpeg (brightness analysis, no AI)
 *      5. Create/link telegram_videos record (metadata only)
 *      6. Create videos table entry (the website catalog)
 *      7. Log the result in autoup_processing_logs
 *
 * Queue: max 2 concurrent processing operations. Internal RAM queue —
 * status is persisted in Neon (autoup_processing_logs) so it survives restarts.
 *
 * No AI, no Valkey/Redis, no new database, no video re-upload.
 */
import { db } from "@workspace/db";
import {
  autoupConfigsTable, autoupProcessingLogsTable,
  telegramSourcesTable, telegramVideosTable, videosTable, usersTable,
} from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { logger } from "../logger";
import { isMtProtoReady, getNewVideoMessages, getMtProtoFileStream, type MtProtoVideoMessage } from "./mtproto";
import { getFileInfo, getFileUrl, isTelegramConfigured } from "./client";
import { uploadThumbnailBufferToMedia } from "../storage/media";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import nodeFs from "node:fs";
import nodePath from "node:path";
import nodeOs from "node:os";

const execFileAsync = promisify(execFile);

// ── Config ───────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = parseInt(process.env.AUTOUP_POLL_INTERVAL_MS || "60000", 10);
const MAX_CONCURRENT = 2;
/** Max bytes to download for thumbnail generation (covers ~20s of most videos). */
const THUMBNAIL_DOWNLOAD_BYTES = 8 * 1024 * 1024; // 8 MB

// ── Title cleaning ───────────────────────────────────────────────────────────

/**
 * Clean a Telegram caption for use as a video title.
 * Preserves emoji and original language. Trims whitespace, removes control
 * characters, collapses excessive line breaks, limits to ~100 characters.
 */
function cleanTitle(raw: string): string {
  return raw
    // Remove control characters (keep \n temporarily for collapse)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    // Collapse 3+ line breaks to 2
    .replace(/\n{3,}/g, "\n\n")
    // Collapse runs of spaces/tabs
    .replace(/[ \t]{2,}/g, " ")
    .trim()
    .substring(0, 100);
}

/** Determine the title from a Telegram video message. No AI, no guessing. */
function deriveTitle(msg: MtProtoVideoMessage): string {
  // Priority 1: caption
  if (msg.caption) {
    const cleaned = cleanTitle(msg.caption);
    if (cleaned) return cleaned;
  }
  // Priority 2: (discussion comments — not available via existing MTProto without
  // complex reply-chain traversal; fall through to fallback per requirements)
  // Priority 3: fallback
  return "Video Baru";
}

// ── Thumbnail generation (FFmpeg, no AI) ─────────────────────────────────────

/**
 * Generate candidate timestamps for frame extraction.
 * For videos >= 20s: [1, 5, 10, 15, 20]
 * For shorter videos: spread across available duration.
 */
function candidateTimestamps(duration: number | null): number[] {
  if (!duration || duration <= 0) return [1];
  if (duration >= 20) return [1, 5, 10, 15, 20];
  // For short videos, spread 4 candidates across the duration
  const candidates: number[] = [];
  const step = Math.max(1, Math.floor(duration / 4));
  for (let t = 1; t < duration; t += step) {
    candidates.push(t);
    if (candidates.length >= 4) break;
  }
  return candidates.length > 0 ? candidates : [1];
}

/**
 * Extract a single frame from a video file at a given timestamp.
 * Returns the path to the JPEG file, or null on failure.
 */
async function extractFrame(videoPath: string, timestamp: number, outputDir: string): Promise<string | null> {
  const outputPath = nodePath.join(outputDir, `frame_${timestamp}.jpg`);
  try {
    await execFileAsync("ffmpeg", [
      "-y", "-ss", String(timestamp), "-i", videoPath,
      "-frames:v", "1", "-q:v", "2", "-vf", "scale=320:-1",
      outputPath,
    ], { timeout: 15000 });
    const stat = await nodeFs.promises.stat(outputPath).catch(() => null);
    if (stat && stat.size > 0) return outputPath;
    return null;
  } catch {
    return null;
  }
}

/**
 * Calculate average brightness of a JPEG file using FFmpeg signalstats.
 * Returns a value 0-1 (0=black, 1=white), or null on failure.
 */
async function getFrameBrightness(imagePath: string): Promise<number | null> {
  try {
    const { stderr } = await execFileAsync("ffmpeg", [
      "-i", imagePath, "-vf", "signalstats", "-f", "null", "-",
    ], { timeout: 10000 });
    // signalstats prints lines like: yuv y_min=.. y_max=.. y_avg=.. in stderr
    const match = stderr.match(/y_avg\s*=\s*([\d.]+)/i)
      || stderr.match(/YAVG\s*:\s*([\d.]+)/i);
    if (match) {
      const val = parseFloat(match[1]);
      // signalstats YAVG is 0-255; normalize to 0-1
      return val > 1 ? val / 255 : val;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Generate a single thumbnail from a video file.
 *
 * Extracts frames at candidate timestamps, analyzes brightness, and picks
 * the best frame (closest to 0.5 — not too dark, not too bright).
 * Falls back to deterministic selection (first available frame) if analysis fails.
 *
 * Returns the JPEG buffer, or null if all extractions fail.
 */
async function generateThumbnail(videoPath: string, duration: number | null): Promise<Buffer | null> {
  const tmpDir = await nodeFs.promises.mkdtemp(nodePath.join(nodeOs.tmpdir(), "autoup-thumb-"));
  try {
    const timestamps = candidateTimestamps(duration);
    const frames: { path: string; timestamp: number; brightness: number | null }[] = [];

    for (const ts of timestamps) {
      const framePath = await extractFrame(videoPath, ts, tmpDir);
      if (framePath) {
        const brightness = await getFrameBrightness(framePath);
        frames.push({ path: framePath, timestamp: ts, brightness });
      }
    }

    if (frames.length === 0) return null;

    // Pick the best frame: prefer brightness closest to 0.5 (well-lit).
    // If brightness analysis failed for all, use the first frame (deterministic).
    let best = frames[0];
    if (frames.some((f) => f.brightness !== null)) {
      let bestDist = Infinity;
      for (const f of frames) {
        if (f.brightness === null) continue;
        const dist = Math.abs(f.brightness - 0.5);
        if (dist < bestDist) {
          bestDist = dist;
          best = f;
        }
      }
    }

    return await nodeFs.promises.readFile(best.path);
  } finally {
    // Clean up temp files
    await nodeFs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Download the first N bytes of a Telegram video via MTProto for thumbnail generation.
 * Uses the existing MTProto singleton — no new connection.
 */
async function downloadVideoChunk(
  chatId: string,
  messageId: string,
  maxBytes: number,
): Promise<string | null> {
  const tmpDir = await nodeFs.promises.mkdtemp(nodePath.join(nodeOs.tmpdir(), "autoup-video-"));
  const videoPath = nodePath.join(tmpDir, "chunk.mp4");

  try {
    const stream = await getMtProtoFileStream(chatId, messageId, 0, maxBytes - 1);
    const writeStream = nodeFs.createWriteStream(videoPath);

    let bytesWritten = 0;
    for await (const chunk of stream.chunks) {
      if (bytesWritten >= maxBytes) break;
      const remaining = maxBytes - bytesWritten;
      const data = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      writeStream.write(data);
      bytesWritten += data.length;
    }
    await new Promise<void>((resolve) => writeStream.end(resolve));

    const stat = await nodeFs.promises.stat(videoPath).catch(() => null);
    if (!stat || stat.size === 0) {
      await nodeFs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      return null;
    }
    return videoPath;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), chatId, messageId },
      "[AUTOUP] Failed to download video chunk for thumbnail",
    );
    await nodeFs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    return null;
  }
}

/** Clean up a temporary video chunk file (and its parent temp dir). */
async function cleanupVideoChunk(videoPath: string): Promise<void> {
  const dir = nodePath.dirname(videoPath);
  await nodeFs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
}

// ── Concurrency limiter (max 2) ───────────────────────────────────────────────

let activeJobs = 0;
const jobQueue: (() => Promise<void>)[] = [];

function enqueueJob(job: () => Promise<void>): void {
  jobQueue.push(job);
  processQueue();
}

function processQueue(): void {
  while (activeJobs < MAX_CONCURRENT && jobQueue.length > 0) {
    const job = jobQueue.shift()!;
    activeJobs++;
    job().finally(() => {
      activeJobs--;
      processQueue();
    });
  }
}

// ── Video processing ─────────────────────────────────────────────────────────

/**
 * Process a single new video message from a Telegram source.
 *
 * Steps:
 *   1. Duplicate check (autoup_processing_logs unique constraint)
 *   2. Create a pending log entry
 *   3. Create/link telegram_videos record (metadata only)
 *   4. Generate thumbnail via FFmpeg (download chunk → extract frames → pick best)
 *   5. Upload thumbnail to Supabase media storage (if configured)
 *   6. Create videos table entry (the website catalog)
 *   7. Update log to completed/failed
 *   8. Update config stats (processed_count / failed_count / last_processed_at)
 */
async function processVideo(
  config: typeof autoupConfigsTable.$inferSelect,
  source: typeof telegramSourcesTable.$inferSelect,
  msg: MtProtoVideoMessage,
): Promise<void> {
  // ── 1. Duplicate check ──────────────────────────────────────────────────
  const [existingLog] = await db.select({ id: autoupProcessingLogsTable.id })
    .from(autoupProcessingLogsTable)
    .where(and(
      eq(autoupProcessingLogsTable.autoupConfigId, config.id),
      eq(autoupProcessingLogsTable.telegramMessageId, msg.messageId),
    ))
    .limit(1);

  if (existingLog) {
    logger.info({ configId: config.id, messageId: msg.messageId }, "[AUTOUP] Duplicate — skipping");
    return;
  }

  const title = deriveTitle(msg);

  // ── 2. Create pending log entry ─────────────────────────────────────────
  const [logEntry] = await db.insert(autoupProcessingLogsTable).values({
    autoupConfigId: config.id,
    telegramSourceId: source.id,
    telegramChatId: source.chatId,
    telegramMessageId: msg.messageId,
    title,
    status: "processing",
  }).returning();

  let telegramVideoId: string | null = null;

  try {
    // ── 3. Create/link telegram_videos record ─────────────────────────────
    const [existingTgVideo] = await db.select({ id: telegramVideosTable.id })
      .from(telegramVideosTable)
      .where(and(
        eq(telegramVideosTable.telegramSourceId, source.id),
        eq(telegramVideosTable.telegramMessageId, msg.messageId),
      ))
      .limit(1);

    // Telegram Source no longer controls premium — isPremium=false, price=null.
    // Premium is determined by the AutoUP config when creating the catalog entry.
    // status starts as "queued" — the video is NOT accessible until verified.
    const tgVideoData = {
      telegramFileId: null, // MTProto uses chatId + messageId, not file_id
      telegramFileUniqueId: msg.documentId,
      fileName: msg.fileName,
      title,
      mimeType: msg.mimeType,
      fileSize: msg.fileSize || null,
      duration: msg.duration,
      width: msg.width,
      height: msg.height,
      caption: msg.caption,
      telegramDate: msg.date,
      status: "queued" as const,
      isPremium: false,
      price: null,
      updatedAt: new Date(),
    };

    if (existingTgVideo) {
      await db.update(telegramVideosTable).set(tgVideoData)
        .where(eq(telegramVideosTable.id, existingTgVideo.id));
      telegramVideoId = existingTgVideo.id;
    } else {
      const [created] = await db.insert(telegramVideosTable).values({
        telegramSourceId: source.id,
        telegramChatId: source.chatId,
        telegramMessageId: msg.messageId,
        ...tgVideoData,
      }).onConflictDoUpdate({
        target: [telegramVideosTable.telegramSourceId, telegramVideosTable.telegramMessageId],
        set: tgVideoData,
      }).returning();
      telegramVideoId = created.id;
    }

    // ── 4. Check if a videos catalog entry already exists for this tg video ──
    const [existingVideo] = await db.select({ id: videosTable.id })
      .from(videosTable)
      .where(and(
        eq(videosTable.telegramVideoId, telegramVideoId),
        sql`${videosTable.deletedAt} IS NULL`,
      ))
      .limit(1);

    if (existingVideo) {
      // Already in the catalog — skip creation, mark as skipped.
      await db.update(autoupProcessingLogsTable).set({
        status: "skipped",
        telegramVideoId,
        videoId: existingVideo.id,
        errorMessage: "Video already exists in catalog",
        processedAt: new Date(),
      }).where(eq(autoupProcessingLogsTable.id, logEntry.id));

      await db.update(autoupConfigsTable).set({
        processedCount: sql`${autoupConfigsTable.processedCount} + 1`,
        lastProcessedAt: new Date(),
      }).where(eq(autoupConfigsTable.id, config.id));

      logger.info({ configId: config.id, messageId: msg.messageId }, "[AUTOUP] Skipped — already in catalog");
      return;
    }

    // ── 5. Generate thumbnail ─────────────────────────────────────────────
    let thumbnailUrl: string | null = null;
    const chunkPath = await downloadVideoChunk(source.chatId, msg.messageId, THUMBNAIL_DOWNLOAD_BYTES);
    if (chunkPath) {
      try {
        const thumbBuffer = await generateThumbnail(chunkPath, msg.duration);
        if (thumbBuffer) {
          const uploaded = await uploadThumbnailBufferToMedia(thumbBuffer, "image/jpeg");
          if (uploaded) thumbnailUrl = uploaded.url;
        }
      } finally {
        await cleanupVideoChunk(chunkPath);
      }
    }

    // ── 6. Storage verification before COMPLETED ──────────────────────────
    // Verify the video metadata is valid before marking as COMPLETED.
    // Only COMPLETED videos are accessible to users.
    const verificationPassed =
      (msg.fileSize ?? 0) > 0 &&           // file size must be > 0
      !!msg.mimeType &&                     // mime type must exist
      msg.mimeType.startsWith("video/");   // must be a video

    if (!verificationPassed) {
      // Mark telegram video as FAILED — do NOT publish to catalog.
      await db.update(telegramVideosTable).set({
        status: "failed",
        updatedAt: new Date(),
      }).where(eq(telegramVideosTable.id, telegramVideoId));

      throw new Error(`Storage verification failed: fileSize=${msg.fileSize}, mimeType=${msg.mimeType}`);
    }

    // Verification passed → mark telegram video as COMPLETED.
    await db.update(telegramVideosTable).set({
      status: "completed",
      updatedAt: new Date(),
    }).where(eq(telegramVideosTable.id, telegramVideoId));

    logger.info({ telegramVideoId }, "[AUTOUP] Telegram video verified → status=completed");

    // ── 7. Resolve creator ID ─────────────────────────────────────────────
    let creatorId = config.createdBy;
    if (!creatorId) {
      // Fallback: find the first owner/admin user
      const [admin] = await db.select({ id: usersTable.id })
        .from(usersTable)
        .where(sql`${usersTable.role} IN ('owner', 'admin')`)
        .limit(1);
      creatorId = admin?.id ?? null;
    }

    if (!creatorId) {
      throw new Error("No creator user found — cannot create video entry");
    }

    // ── 8. Create videos table entry (the website catalog) ───────────────
    // Only published AFTER telegram video is verified + COMPLETED.
    // Premium/Free is determined by the AutoUP config, NOT the Telegram source.
    const visibility = config.isPremium ? "premium" : "public";
    const videoUrl = `/api/telegram-videos/${telegramVideoId}/stream`;

    const [newVideo] = await db.insert(videosTable).values({
      title,
      description: config.description ?? null,
      thumbnail: thumbnailUrl,
      videoUrl,
      videoSourceType: "telegram",
      telegramVideoId,
      price: config.isPremium ? (config.price ?? 0) : null,
      duration: msg.duration,
      status: "published",
      creatorId,
      visibility,
      type: config.isPremium ? "premium" : "free",
      bundleExclusive: false,
      uploaderType: "owner",
    }).returning();

    // ── 8. Update log + config stats ──────────────────────────────────────
    await db.update(autoupProcessingLogsTable).set({
      status: "completed",
      thumbnail: thumbnailUrl,
      telegramVideoId,
      videoId: newVideo.id,
      processedAt: new Date(),
    }).where(eq(autoupProcessingLogsTable.id, logEntry.id));

    await db.update(autoupConfigsTable).set({
      processedCount: sql`${autoupConfigsTable.processedCount} + 1`,
      lastProcessedAt: new Date(),
    }).where(eq(autoupConfigsTable.id, config.id));

    // Update source video count
    await db.update(telegramSourcesTable).set({
      videoCount: sql`(SELECT count(*)::int FROM telegram_videos WHERE telegram_source_id = ${source.id})`,
      lastSyncAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(telegramSourcesTable.id, source.id));

    logger.info(
      { configId: config.id, videoId: newVideo.id, title, messageId: msg.messageId },
      "[AUTOUP] Video imported successfully",
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message.substring(0, 500) : String(err);
    logger.error({ err: errMsg, configId: config.id, messageId: msg.messageId }, "[AUTOUP] Processing failed");

    // Mark the telegram video as FAILED if it was created.
    if (telegramVideoId) {
      await db.update(telegramVideosTable).set({
        status: "failed",
        updatedAt: new Date(),
      }).where(eq(telegramVideosTable.id, telegramVideoId)).catch(() => {});
    }

    await db.update(autoupProcessingLogsTable).set({
      status: "failed",
      errorMessage: errMsg,
      processedAt: new Date(),
    }).where(eq(autoupProcessingLogsTable.id, logEntry.id));

    await db.update(autoupConfigsTable).set({
      failedCount: sql`${autoupConfigsTable.failedCount} + 1`,
      lastProcessedAt: new Date(),
    }).where(eq(autoupConfigsTable.id, config.id));
  }
}

// ── Polling loop ─────────────────────────────────────────────────────────────

let pollTimer: ReturnType<typeof setInterval> | null = null;
let polling = false;

/** Track sources already logged as "not connected" so we don't spam every 60s. */
const loggedSkippedSources = new Set<string>();

/**
 * One polling cycle: iterate all enabled AutoUP configs, fetch new video
 * messages from their sources via MTProto, and enqueue processing jobs.
 */
async function pollOnce(): Promise<void> {
  if (polling) return;
  polling = true;

  try {
    // Get all enabled configs with their source info.
    const configs = await db.select({
      config: autoupConfigsTable,
      source: telegramSourcesTable,
    })
      .from(autoupConfigsTable)
      .innerJoin(telegramSourcesTable,
        eq(autoupConfigsTable.telegramSourceId, telegramSourcesTable.id))
      .where(eq(autoupConfigsTable.enabled, true));

    if (configs.length === 0) return;

    if (!isMtProtoReady()) {
      logger.warn("[AUTOUP] MTProto not ready — skipping poll cycle");
      return;
    }

    for (const { config, source } of configs) {
      try {
        // Skip disconnected sources (log only once per source to avoid noise)
        if (source.status === "DISCONNECTED" || source.status === "ERROR") {
          if (!loggedSkippedSources.has(source.id)) {
            loggedSkippedSources.add(source.id);
            logger.info(
              { configId: config.id, sourceId: source.id, status: source.status },
              "[AUTOUP] Source not connected — skipping (will not log again for this source)",
            );
          }
          continue;
        }
        // Source is connected — clear the logged flag so we log again if it disconnects later
        loggedSkippedSources.delete(source.id);

        const minId = config.lastProcessedMessageId || "0";
        const { videos, maxMessageId } = await getNewVideoMessages(source.chatId, minId, 50);

        // Update lastProcessedMessageId to the highest message ID seen
        // (even if no videos were found, so we don't re-scan non-video messages).
        if (maxMessageId !== minId && maxMessageId !== "0") {
          await db.update(autoupConfigsTable).set({
            lastProcessedMessageId: maxMessageId,
            updatedAt: new Date(),
          }).where(eq(autoupConfigsTable.id, config.id));
        }

        if (videos.length === 0) continue;

        logger.info(
          { configId: config.id, sourceId: source.id, newVideos: videos.length },
          "[AUTOUP] New video messages detected",
        );

        // Enqueue each video for processing (max 2 concurrent).
        for (const msg of videos) {
          enqueueJob(() => processVideo(config, source, msg));
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        // BOT_METHOD_INVALID: bots can't call messages.getHistory on channels.
        // Mark the source as ERROR so it's skipped in all future poll cycles
        // instead of retrying and logging the same error every 60 seconds.
        if (errMsg.includes("BOT_METHOD_INVALID")) {
          logger.warn(
            { err: errMsg, configId: config.id, sourceId: source.id },
            "[AUTOUP] Bot cannot poll this source (BOT_METHOD_INVALID) — marking source as ERROR",
          );
          await db.update(telegramSourcesTable).set({
            status: "ERROR",
            errorMessage: "Bot cannot access channel history (BOT_METHOD_INVALID)",
            updatedAt: new Date(),
          }).where(eq(telegramSourcesTable.id, source.id)).catch(() => {});
        } else {
          logger.error(
            { err: errMsg, configId: config.id },
            "[AUTOUP] Polling error for config",
          );
        }
      }
    }
  } catch (err) {
    logger.error({ err }, "[AUTOUP] Poll cycle error");
  } finally {
    polling = false;
  }
}

// ── Webhook-triggered AutoUP (primary path for channels) ─────────────────────
//
// Bots cannot use messages.getHistory (MTProto polling) on channels — Telegram
// returns BOT_METHOD_INVALID. Instead, the webhook indexer receives new videos
// in real-time when the bot is a member of the channel. After the indexer
// creates a telegram_videos record and marks it "completed", it calls this
// function to trigger AutoUP catalog entry creation.
//
// Flow: Webhook → indexer creates telegram_videos (status=completed)
//    → processVideoFromWebhook → finds matching AutoUP configs
//    → creates videos catalog entry with config settings (premium/price/desc)
//    → downloads thumbnail via Bot API (or FFmpeg via MTProto as fallback)
//    → logs result in autoup_processing_logs

/**
 * Download a file (e.g. thumbnail) via Bot API getFile + HTTP fetch.
 * Returns null on failure (non-fatal — thumbnail stays null).
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
      "[AUTOUP] Failed to download thumbnail via Bot API",
    );
    return null;
  }
}

/**
 * Process a single webhook-indexed video for a specific AutoUP config.
 * Creates the videos catalog entry with the config's premium/price/description.
 */
async function processWebhookVideoForConfig(
  config: typeof autoupConfigsTable.$inferSelect,
  source: typeof telegramSourcesTable.$inferSelect,
  tgVideo: typeof telegramVideosTable.$inferSelect,
): Promise<void> {
  const messageId = tgVideo.telegramMessageId;

  // ── 1. Duplicate check (autoup_processing_logs unique constraint) ──────
  const [existingLog] = await db.select({ id: autoupProcessingLogsTable.id })
    .from(autoupProcessingLogsTable)
    .where(and(
      eq(autoupProcessingLogsTable.autoupConfigId, config.id),
      eq(autoupProcessingLogsTable.telegramMessageId, messageId),
    ))
    .limit(1);

  if (existingLog) {
    logger.info({ configId: config.id, messageId }, "[AUTOUP] Webhook: Duplicate — skipping");
    return;
  }

  const title = tgVideo.title || tgVideo.caption || "Video Baru";

  // ── 2. Create pending log entry ─────────────────────────────────────────
  const [logEntry] = await db.insert(autoupProcessingLogsTable).values({
    autoupConfigId: config.id,
    telegramSourceId: source.id,
    telegramChatId: source.chatId,
    telegramMessageId: messageId,
    title,
    status: "processing",
  }).returning();

  let telegramVideoId = tgVideo.id;

  try {
    // ── 3. Check if videos catalog entry already exists ────────────────────
    const [existingVideo] = await db.select({ id: videosTable.id })
      .from(videosTable)
      .where(and(
        eq(videosTable.telegramVideoId, telegramVideoId),
        sql`${videosTable.deletedAt} IS NULL`,
      ))
      .limit(1);

    if (existingVideo) {
      await db.update(autoupProcessingLogsTable).set({
        status: "skipped",
        telegramVideoId,
        videoId: existingVideo.id,
        errorMessage: "Video already exists in catalog",
        processedAt: new Date(),
      }).where(eq(autoupProcessingLogsTable.id, logEntry.id));

      await db.update(autoupConfigsTable).set({
        processedCount: sql`${autoupConfigsTable.processedCount} + 1`,
        lastProcessedAt: new Date(),
      }).where(eq(autoupConfigsTable.id, config.id));

      logger.info({ configId: config.id, messageId }, "[AUTOUP] Webhook: Skipped — already in catalog");
      return;
    }

    // ── 4. Generate/download thumbnail ───────────────────────────────────
    let thumbnailUrl: string | null = null;

    // 4a. Try Bot API thumbnail (from webhook metadata — telegram_videos.thumbnailFileId)
    if (tgVideo.thumbnailFileId) {
      const thumbBuffer = await downloadThumbnailViaBotApi(tgVideo.thumbnailFileId);
      if (thumbBuffer) {
        const uploaded = await uploadThumbnailBufferToMedia(thumbBuffer, "image/jpeg");
        if (uploaded) thumbnailUrl = uploaded.url;
      }
    }

    // 4b. Fall back to FFmpeg via MTProto if no Bot API thumbnail
    if (!thumbnailUrl && isMtProtoReady()) {
      const chunkPath = await downloadVideoChunk(source.chatId, messageId, THUMBNAIL_DOWNLOAD_BYTES);
      if (chunkPath) {
        try {
          const thumbBuffer = await generateThumbnail(chunkPath, tgVideo.duration);
          if (thumbBuffer) {
            const uploaded = await uploadThumbnailBufferToMedia(thumbBuffer, "image/jpeg");
            if (uploaded) thumbnailUrl = uploaded.url;
          }
        } finally {
          await cleanupVideoChunk(chunkPath);
        }
      }
    }

    // ── 5. Resolve creator ID ─────────────────────────────────────────────
    let creatorId = config.createdBy;
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

    // ── 6. Create videos catalog entry ────────────────────────────────────
    const visibility = config.isPremium ? "premium" : "public";
    const videoUrl = `/api/telegram-videos/${telegramVideoId}/stream`;

    const [newVideo] = await db.insert(videosTable).values({
      title,
      description: config.description ?? null,
      thumbnail: thumbnailUrl,
      videoUrl,
      videoSourceType: "telegram",
      telegramVideoId,
      price: config.isPremium ? (config.price ?? 0) : null,
      duration: tgVideo.duration,
      status: "published",
      creatorId,
      visibility,
      type: config.isPremium ? "premium" : "free",
      bundleExclusive: false,
      uploaderType: "owner",
    }).returning();

    // ── 7. Update log + config stats ──────────────────────────────────────
    await db.update(autoupProcessingLogsTable).set({
      status: "completed",
      thumbnail: thumbnailUrl,
      telegramVideoId,
      videoId: newVideo.id,
      processedAt: new Date(),
    }).where(eq(autoupProcessingLogsTable.id, logEntry.id));

    await db.update(autoupConfigsTable).set({
      processedCount: sql`${autoupConfigsTable.processedCount} + 1`,
      lastProcessedAt: new Date(),
    }).where(eq(autoupConfigsTable.id, config.id));

    logger.info(
      { configId: config.id, videoId: newVideo.id, title, messageId },
      "[AUTOUP] Webhook: Video imported successfully",
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message.substring(0, 500) : String(err);
    logger.error({ err: errMsg, configId: config.id, messageId }, "[AUTOUP] Webhook: Processing failed");

    await db.update(autoupProcessingLogsTable).set({
      status: "failed",
      errorMessage: errMsg,
      telegramVideoId,
      processedAt: new Date(),
    }).where(eq(autoupProcessingLogsTable.id, logEntry.id));

    await db.update(autoupConfigsTable).set({
      failedCount: sql`${autoupConfigsTable.failedCount} + 1`,
      lastProcessedAt: new Date(),
    }).where(eq(autoupConfigsTable.id, config.id));
  }
}

/**
 * Webhook-triggered AutoUP entry point.
 *
 * Called by the webhook indexer after a new telegram_videos record is created
 * and marked as "completed". Finds all enabled AutoUP configs matching the
 * source and creates videos catalog entries with each config's settings.
 *
 * This is the PRIMARY detection path for channels — MTProto polling (bots
 * cannot use messages.getHistory on channels) is kept as a fallback for
 * sources where MTProto works (e.g. groups).
 *
 * Non-blocking: errors are caught and logged — never propagate to the caller.
 */
export async function processVideoFromWebhook(
  sourceId: string,
  telegramVideoId: string,
): Promise<void> {
  // 1. Find enabled AutoUP configs for this source.
  const configs = await db.select({
    config: autoupConfigsTable,
    source: telegramSourcesTable,
  })
    .from(autoupConfigsTable)
    .innerJoin(telegramSourcesTable,
      eq(autoupConfigsTable.telegramSourceId, telegramSourcesTable.id))
    .where(and(
      eq(autoupConfigsTable.telegramSourceId, sourceId),
      eq(autoupConfigsTable.enabled, true),
    ));

  if (configs.length === 0) return;

  // 2. Get the telegram_videos record.
  const [tgVideo] = await db.select()
    .from(telegramVideosTable)
    .where(eq(telegramVideosTable.id, telegramVideoId))
    .limit(1);

  if (!tgVideo) {
    logger.warn({ telegramVideoId }, "[AUTOUP] Webhook trigger: telegram_videos record not found");
    return;
  }

  logger.info(
    { sourceId, telegramVideoId, configCount: configs.length, messageId: tgVideo.telegramMessageId },
    "[AUTOUP] Webhook trigger: processing video for AutoUP configs",
  );

  // 3. Process for each matching config.
  for (const { config, source } of configs) {
    await processWebhookVideoForConfig(config, source, tgVideo).catch((err) => {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), configId: config.id },
        "[AUTOUP] Webhook: unexpected error in processWebhookVideoForConfig",
      );
    });
  }
}

/** Start the AutoUP background processor. Call once on module load. */
export function startAutoUpProcessor(): void {
  if (pollTimer) return;
  pollTimer = setInterval(() => { pollOnce().catch(() => {}); }, POLL_INTERVAL_MS);
  // Run one cycle shortly after startup (give MTProto time to connect).
  setTimeout(() => { pollOnce().catch(() => {}); }, 10000);
  logger.info(`[AUTOUP] Processor started (MTProto polling interval: ${POLL_INTERVAL_MS / 1000}s, max concurrent: ${MAX_CONCURRENT}). Webhook-triggered processing is active for channels.`);
}

// ── Stats ────────────────────────────────────────────────────────────────────

export async function getAutoUpStats(): Promise<{
  total: number;
  active: number;
  inactive: number;
  videosSucceeded: number;
  videosFailed: number;
}> {
  const [configStats] = await db.select({
    total: sql<number>`count(*)::int`,
    active: sql<number>`count(*) filter (where ${autoupConfigsTable.enabled} = true)::int`,
    inactive: sql<number>`count(*) filter (where ${autoupConfigsTable.enabled} = false)::int`,
  }).from(autoupConfigsTable);

  const [logStats] = await db.select({
    succeeded: sql<number>`count(*) filter (where ${autoupProcessingLogsTable.status} = 'completed')::int`,
    failed: sql<number>`count(*) filter (where ${autoupProcessingLogsTable.status} = 'failed')::int`,
  }).from(autoupProcessingLogsTable);

  return {
    total: configStats?.total ?? 0,
    active: configStats?.active ?? 0,
    inactive: configStats?.inactive ?? 0,
    videosSucceeded: logStats?.succeeded ?? 0,
    videosFailed: logStats?.failed ?? 0,
  };
}
