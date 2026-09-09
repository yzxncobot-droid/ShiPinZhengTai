/**
 * Stream concurrency limiter — allows up to MAX_CONCURRENT_STREAMS (default 20)
 * simultaneous Telegram video streaming operations. When all slots are in use,
 * additional requests enter a FIFO waiting queue and are processed as slots
 * free up. Waiting requests that exceed QUEUE_TIMEOUT_MS are rejected.
 *
 * Each stream acquires a slot BEFORE starting (after auth + premium checks)
 * and releases it in a finally block — guaranteeing slot return on success,
 * error, client disconnect, or cancellation. The limiter counts active
 * Telegram transfer operations, not HTTP connections (a single video may
 * produce multiple Range requests, each consuming a slot).
 *
 * Architecture:
 *
 *   Browser 1 ──→ slot 1 ──→ MTProto ──→ Telegram
 *   Browser 2 ──→ slot 2 ──→ MTProto ──→ Telegram
 *   ...
 *   Browser 20 ─→ slot 20 ──→ MTProto ──→ Telegram
 *
 *   Browser 21+ → FIFO waiting queue → slot frees → streaming starts
 *
 * Streaming starts immediately for available slots — no full-file download
 * before playback. HTTP Range is mapped to MTProto offset for chunk streaming.
 */
import { logger } from "../logger";

const MAX_CONCURRENT_STREAMS = Math.max(1, parseInt(process.env.STREAM_MAX_CONCURRENCY || "20", 10));
const QUEUE_TIMEOUT_MS = Math.max(5000, parseInt(process.env.STREAM_QUEUE_TIMEOUT_MS || "30000", 10));

interface QueueTask {
  resolve: () => void;
  reject: (err: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
  queuedAt: number;
}

let active = 0;
let totalProcessed = 0;
let totalFailed = 0;
let totalTimedOut = 0;
const waiting: QueueTask[] = [];

/**
 * Try to dispatch waiting requests from the FIFO queue.
 * Called whenever a slot is released or a new request is queued.
 */
function pump(): void {
  while (active < MAX_CONCURRENT_STREAMS && waiting.length > 0) {
    const task = waiting.shift()!;
    clearTimeout(task.timer);
    active++;
    logger.info(
      { slot: active, max: MAX_CONCURRENT_STREAMS },
      "[STREAM] acquired slot %d/%d", active, MAX_CONCURRENT_STREAMS,
    );
    task.resolve();
  }
}

/**
 * Acquire a stream slot. Resolves immediately if a slot is free;
 * otherwise waits in the FIFO queue until a slot frees up or the
 * queue timeout expires (FIFO — no starvation).
 */
function acquireSlot(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // Fast path: a slot is free and no one is waiting — start immediately.
    if (active < MAX_CONCURRENT_STREAMS && waiting.length === 0) {
      active++;
      logger.info(
        { slot: active, max: MAX_CONCURRENT_STREAMS },
        "[STREAM] acquired slot %d/%d", active, MAX_CONCURRENT_STREAMS,
      );
      resolve();
      return;
    }

    // Slow path: all slots in use — wait in the FIFO queue.
    const queuedAt = Date.now();
    const task: QueueTask = { resolve, reject, timer: null as any, queuedAt };

    task.timer = setTimeout(() => {
      const idx = waiting.indexOf(task);
      if (idx !== -1) waiting.splice(idx, 1);
      totalTimedOut++;
      logger.warn(
        { waitMs: Date.now() - queuedAt, queueLen: waiting.length },
        "[STREAM QUEUE] request timed out waiting for a slot",
      );
      reject(new Error("Stream queue timeout — terlalu banyak permintaan, coba lagi sebentar"));
    }, QUEUE_TIMEOUT_MS);

    waiting.push(task);
    logger.info(
      { position: waiting.length, active, max: MAX_CONCURRENT_STREAMS },
      "[STREAM QUEUE] request queued at position %d (active %d/%d)",
      waiting.length, active, MAX_CONCURRENT_STREAMS,
    );
    pump();
  });
}

/**
 * Release a stream slot and dispatch the next waiting request.
 */
function releaseSlot(): void {
  active--;
  logger.info(
    { slot: active, max: MAX_CONCURRENT_STREAMS },
    "[STREAM] released slot, now %d/%d active", active, MAX_CONCURRENT_STREAMS,
  );
  pump();
}

/**
 * Run a streaming function through the concurrency limiter.
 *
 * If all 20 slots are in use, the request waits until a slot frees
 * (or times out). The slot is ALWAYS released via try/finally —
 * on success, error, client disconnect, or cancellation.
 *
 * Usage:
 *   await enqueueStream(async () => {
 *     // stream chunks to response
 *   });
 */
export async function enqueueStream(fn: () => Promise<void>): Promise<void> {
  await acquireSlot();
  try {
    await fn();
    totalProcessed++;
  } catch (err) {
    totalFailed++;
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "[STREAM] task failed",
    );
    throw err;
  } finally {
    releaseSlot();
  }
}

export interface StreamQueueStats {
  maxConcurrency: number;
  active: number;
  waiting: number;
  totalProcessed: number;
  totalFailed: number;
  totalTimedOut: number;
}

export function getStreamQueueStats(): StreamQueueStats {
  return {
    maxConcurrency: MAX_CONCURRENT_STREAMS,
    active,
    waiting: waiting.length,
    totalProcessed,
    totalFailed,
    totalTimedOut,
  };
}
