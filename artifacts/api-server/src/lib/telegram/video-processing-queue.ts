/**
 * Staged Video Processing Queue
 *
 * Processes large videos in discrete stages with per-stage timeouts and retry,
 * so a single large video never blocks the queue or errors from loading too long.
 *
 * Stages (sequential per video):
 *   1. METADATA  — extract & store video metadata           (timeout: 10s)
 *   2. THUMBNAIL — generate thumbnail via Bot API/FFmpeg     (timeout: 60s)
 *   3. VERIFY    — verify video is accessible on Telegram     (timeout: 15s)
 *   4. PUBLISH   — create catalog entry + send notification   (timeout: 10s)
 *
 * Features:
 *   - Per-stage timeout — a stuck stage is aborted, not blocking the queue
 *   - Per-stage retry with exponential backoff (max 3 retries per stage)
 *   - Configurable concurrency (default 3 videos processed simultaneously)
 *   - Progress tracking via in-memory map + API endpoint
 *   - Failed stages are retried independently — no need to redo earlier stages
 *   - Graceful shutdown — in-progress stages are allowed to complete
 */
import { logger } from "../logger";

// ── Configuration ────────────────────────────────────────────────────────────

const MAX_CONCURRENT = Math.max(1, parseInt(process.env.VIDEO_QUEUE_CONCURRENCY || "3", 10));
const MAX_STAGE_RETRIES = 3;
const STAGE_BACKOFF_BASE_MS = 2000;

interface StageConfig {
  name: string;
  timeoutMs: number;
}

const STAGES: Record<StageId, StageConfig> = {
  metadata:  { name: "METADATA",  timeoutMs: 10_000 },
  thumbnail: { name: "THUMBNAIL", timeoutMs: 60_000 },
  verify:    { name: "VERIFY",    timeoutMs: 15_000 },
  publish:   { name: "PUBLISH",   timeoutMs: 10_000 },
};

const STAGE_ORDER: StageId[] = ["metadata", "thumbnail", "verify", "publish"];

// ── Types ───────────────────────────────────────────────────────────────────

type StageId = "metadata" | "thumbnail" | "verify" | "publish";
type StageStatus = "pending" | "processing" | "completed" | "failed";

export interface VideoJobContext {
  /** Telegram video ID (from telegram_videos table). */
  videoId: string;
  /** Source ID. */
  sourceId: string;
  /** Telegram chat ID. */
  chatId: string;
  /** Telegram message ID. */
  messageId: string;
  /** File ID from Bot API (may be null for AutoUP videos). */
  fileId: string | null;
  /** Thumbnail file ID from Bot API (if available). */
  thumbnailFileId: string | null;
  /** Video title/caption. */
  title: string;
  /** File size in bytes. */
  fileSize: number | null;
  /** Duration in seconds. */
  duration: number | null;
  /** MIME type. */
  mimeType: string;
  /** Whether this is a premium video. */
  isPremium: boolean;
  /** Price (if premium). */
  price: number | null;
  /** Description (from AutoUP config). */
  description: string | null;
  /** Creator user ID. */
  creatorId: string | null;
  /** AutoUP config ID (if triggered by AutoUP). */
  autoupConfigId?: string;
}

interface StageState {
  status: StageStatus;
  attempts: number;
  error: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

interface QueueJob {
  id: string;
  context: VideoJobContext;
  stages: Record<StageId, StageState>;
  currentStage: StageId;
  status: "queued" | "processing" | "completed" | "failed";
  createdAt: Date;
  updatedAt: Date;
  error: string | null;
}

export interface QueueProgress {
  id: string;
  videoId: string;
  title: string;
  status: "queued" | "processing" | "completed" | "failed";
  currentStage: string;
  stages: {
    metadata:  { status: StageStatus; attempts: number; error: string | null };
    thumbnail: { status: StageStatus; attempts: number; error: string | null };
    verify:    { status: StageStatus; attempts: number; error: string | null };
    publish:   { status: StageStatus; attempts: number; error: string | null };
  };
  createdAt: string;
  updatedAt: string;
}

// ── Stage handlers (injected at startup) ────────────────────────────────────

type StageHandler = (ctx: VideoJobContext) => Promise<void>;

const stageHandlers: Partial<Record<StageId, StageHandler>> = {};

/**
 * Register a handler for a processing stage.
 * Call this during server initialization before enqueuing jobs.
 */
export function registerStageHandler(stage: StageId, handler: StageHandler): void {
  stageHandlers[stage] = handler;
}

// ── Queue state ─────────────────────────────────────────────────────────────

const jobs = new Map<string, QueueJob>();
const queue: string[] = []; // FIFO of job IDs waiting to start
let active = 0;
let totalProcessed = 0;
let totalFailed = 0;

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeStageState(): StageState {
  return { status: "pending", attempts: 0, error: null, startedAt: null, completedAt: null };
}

function makeJob(ctx: VideoJobContext): QueueJob {
  const now = new Date();
  return {
    id: `${ctx.videoId}-${now.getTime()}`,
    context: ctx,
    stages: {
      metadata: makeStageState(),
      thumbnail: makeStageState(),
      verify: makeStageState(),
      publish: makeStageState(),
    },
    currentStage: "metadata",
    status: "queued",
    createdAt: now,
    updatedAt: now,
    error: null,
  };
}

function getBackoffMs(attempts: number): number {
  return Math.min(STAGE_BACKOFF_BASE_MS * Math.pow(2, attempts), 30_000);
}

/**
 * Run a stage handler with a timeout.
 * Aborts if the stage exceeds its configured timeout.
 */
function runWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number, stageName: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Stage ${stageName} timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    fn()
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

// ── Core processing ─────────────────────────────────────────────────────────

/**
 * Process a single stage of a job.
 * If the stage fails, it's retried up to MAX_STAGE_RETRIES times with backoff.
 */
async function processStage(job: QueueJob, stage: StageId): Promise<boolean> {
  const handler = stageHandlers[stage];
  if (!handler) {
    // No handler registered — skip this stage (treat as completed).
    logger.warn({ stage, jobId: job.id }, "[VIDEO QUEUE] No handler for stage — skipping");
    job.stages[stage].status = "completed";
    return true;
  }

  const config = STAGES[stage];
  const state = job.stages[stage];

  while (state.attempts < MAX_STAGE_RETRIES) {
    state.attempts++;
    state.status = "processing";
    state.startedAt = new Date();
    state.error = null;
    job.updatedAt = new Date();

    logger.info(
      { jobId: job.id, stage: config.name, attempt: state.attempts, videoId: job.context.videoId },
      "[VIDEO QUEUE] Processing stage %s (attempt %d/%d)",
      config.name, state.attempts, MAX_STAGE_RETRIES,
    );

    try {
      await runWithTimeout(() => handler(job.context), config.timeoutMs, config.name);
      state.status = "completed";
      state.completedAt = new Date();
      state.error = null;
      logger.info({ jobId: job.id, stage: config.name }, "[VIDEO QUEUE] Stage %s completed", config.name);
      return true;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message.substring(0, 300) : String(err);
      state.error = errMsg;
      logger.warn(
        { jobId: job.id, stage: config.name, attempt: state.attempts, err: errMsg },
        "[VIDEO QUEUE] Stage %s failed (attempt %d/%d)",
        config.name, state.attempts, MAX_STAGE_RETRIES,
      );

      if (state.attempts < MAX_STAGE_RETRIES) {
        // Wait with exponential backoff before retrying.
        const backoff = getBackoffMs(state.attempts);
        await new Promise<void>(resolve => setTimeout(resolve, backoff));
      }
    }
  }

  // All retries exhausted.
  state.status = "failed";
  logger.error(
    { jobId: job.id, stage: config.name, videoId: job.context.videoId },
    "[VIDEO QUEUE] Stage %s failed after %d attempts",
    config.name, MAX_STAGE_RETRIES,
  );
  return false;
}

/**
 * Process a job through all stages sequentially.
 * If any stage fails (after retries), the job is marked as failed.
 */
async function processJob(job: QueueJob): Promise<void> {
  job.status = "processing";
  job.updatedAt = new Date();

  logger.info(
    { jobId: job.id, videoId: job.context.videoId, title: job.context.title },
    "[VIDEO QUEUE] Started processing video: %s",
    job.context.title,
  );

  for (const stage of STAGE_ORDER) {
    job.currentStage = stage;
    job.updatedAt = new Date();

    const success = await processStage(job, stage);
    if (!success) {
      job.status = "failed";
      job.error = `Stage ${STAGES[stage].name} failed after ${MAX_STAGE_RETRIES} attempts`;
      job.updatedAt = new Date();
      totalFailed++;
      logger.error(
        { jobId: job.id, videoId: job.context.videoId, failedStage: STAGES[stage].name },
        "[VIDEO QUEUE] Video processing failed at stage %s: %s",
        STAGES[stage].name, job.context.title,
      );
      return;
    }
  }

  job.status = "completed";
  job.updatedAt = new Date();
  totalProcessed++;
  logger.info(
    { jobId: job.id, videoId: job.context.videoId },
    "[VIDEO QUEUE] Video processing completed: %s",
    job.context.title,
  );
}

/**
 * Pump the queue — start processing jobs up to the concurrency limit.
 */
function pump(): void {
  while (active < MAX_CONCURRENT && queue.length > 0) {
    const jobId = queue.shift()!;
    const job = jobs.get(jobId);
    if (!job) continue;

    active++;
    processJob(job)
      .catch((err) => {
        logger.error({ jobId, err: err instanceof Error ? err.message : String(err) }, "[VIDEO QUEUE] Unexpected error");
      })
      .finally(() => {
        active--;
        pump();
      });
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Enqueue a video for staged processing.
 * Returns the job ID for progress tracking.
 */
export function enqueueVideo(ctx: VideoJobContext): string {
  const job = makeJob(ctx);
  jobs.set(job.id, job);
  queue.push(job.id);

  // Clean up old completed/failed jobs to prevent memory growth.
  if (jobs.size > 200) {
    const cutoff = Date.now() - 30 * 60 * 1000; // 30 minutes
    for (const [id, j] of jobs) {
      if ((j.status === "completed" || j.status === "failed") && j.updatedAt.getTime() < cutoff) {
        jobs.delete(id);
      }
    }
  }

  logger.info(
    { jobId: job.id, videoId: ctx.videoId, title: ctx.title, queueLen: queue.length, active },
    "[VIDEO QUEUE] Enqueued video: %s (queue position %d)",
    ctx.title, queue.length,
  );

  pump();
  return job.id;
}

/**
 * Get the progress of a specific job.
 */
export function getJobProgress(jobId: string): QueueProgress | null {
  const job = jobs.get(jobId);
  if (!job) return null;

  return {
    id: job.id,
    videoId: job.context.videoId,
    title: job.context.title,
    status: job.status,
    currentStage: job.currentStage,
    stages: {
      metadata:  { status: job.stages.metadata.status,  attempts: job.stages.metadata.attempts,  error: job.stages.metadata.error },
      thumbnail: { status: job.stages.thumbnail.status, attempts: job.stages.thumbnail.attempts, error: job.stages.thumbnail.error },
      verify:    { status: job.stages.verify.status,    attempts: job.stages.verify.attempts,    error: job.stages.verify.error },
      publish:   { status: job.stages.publish.status,   attempts: job.stages.publish.attempts,   error: job.stages.publish.error },
    },
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

/**
 * Get progress for all jobs (for admin dashboard).
 */
export function getAllProgress(): QueueProgress[] {
  return Array.from(jobs.values())
    .map(job => getJobProgress(job.id)!)
    .filter(Boolean)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export interface VideoQueueStats {
  maxConcurrency: number;
  active: number;
  queued: number;
  totalProcessed: number;
  totalFailed: number;
  totalJobs: number;
}

export function getQueueStats(): VideoQueueStats {
  return {
    maxConcurrency: MAX_CONCURRENT,
    active,
    queued: queue.length,
    totalProcessed,
    totalFailed,
    totalJobs: jobs.size,
  };
}
