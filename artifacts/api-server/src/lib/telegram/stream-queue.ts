/**
 * Stream concurrency queue — limits how many video streams fetch from
 * Telegram simultaneously. Without this, every concurrent viewer triggers
 * an independent Telegram download, which can exhaust memory, CPU, and
 * trigger Telegram rate limits (429).
 *
 * The queue is a simple FIFO with a configurable max-concurrency semaphore.
 * Default is 1 (process one stream at a time) but can be raised via the
 * STREAM_MAX_CONCURRENCY environment variable.
 *
 * Waiting items that exceed STREAM_QUEUE_TIMEOUT_MS (default 30 s) are
 * rejected so a browser never hangs indefinitely.
 */
import { logger } from "../logger";

const MAX_CONCURRENCY = Math.max(1, parseInt(process.env.STREAM_MAX_CONCURRENCY || "1", 10));
const QUEUE_TIMEOUT_MS = Math.max(5000, parseInt(process.env.STREAM_QUEUE_TIMEOUT_MS || "30000", 10));

interface QueueTask {
  fn: () => Promise<void>;
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

function pump(): void {
  while (active < MAX_CONCURRENCY && waiting.length > 0) {
    const task = waiting.shift()!;
    clearTimeout(task.timer);
    active++;

    task.fn()
      .then(() => { totalProcessed++; task.resolve(); })
      .catch((err) => {
        totalFailed++;
        logger.error({ err: err instanceof Error ? err.message : String(err) }, "[STREAM QUEUE] task failed");
        task.reject(err);
      })
      .finally(() => { active--; pump(); });
  }
}

/**
 * Run a streaming function through the concurrency queue.
 * If the queue is full, the request waits until a slot frees up
 * (or times out).
 */
export function enqueueStream(fn: () => Promise<void>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const run = () => {
      active++;
      fn()
        .then(() => { totalProcessed++; resolve(); })
        .catch((err) => { totalFailed++; reject(err); })
        .finally(() => { active--; pump(); });
    };

    // If we have a free slot, run immediately.
    if (active < MAX_CONCURRENCY && waiting.length === 0) {
      run();
      return;
    }

    // Otherwise, queue it with a timeout.
    const queuedAt = Date.now();
    const task: QueueTask = {
      fn,
      resolve,
      reject,
      timer: null as any,
      queuedAt,
    };

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
      { position: waiting.length, active, max: MAX_CONCURRENCY },
      "[STREAM QUEUE] request queued",
    );
    pump();
  });
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
    maxConcurrency: MAX_CONCURRENCY,
    active,
    waiting: waiting.length,
    totalProcessed,
    totalFailed,
    totalTimedOut,
  };
}
