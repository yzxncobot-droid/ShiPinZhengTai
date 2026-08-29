/**
 * Layerbase Valkey heartbeat service.
 *
 * Performs a lightweight KV write on a fixed key with a TTL to keep the
 * Layerbase Valkey (Redis-compatible REST API) from going idle/hibernating.
 *
 * The heartbeat is triggered by an EXTERNAL cron job hitting
 * `GET /api/health/layerbase` — there is no setInterval loop here, so the
 * heartbeat survives serverless restarts and multi-instance deployments.
 *
 * Security:
 *  - Uses the existing `redis` client from `lib/redis.ts` (never creates a
 *    new connection).
 *  - Never logs, returns, or exposes KV_REST_API_TOKEN / KV_REST_API_URL.
 *  - Only stores a timestamp — no user or application data.
 */
import { redis, isRedisAvailable } from "../lib/redis";
import { logger } from "../lib/logger";

/** Fixed heartbeat key — reused every cycle so storage doesn't grow. */
export const HEARTBEAT_KEY = "__system:layerbase:heartbeat";

/** TTL in seconds (10 minutes). Heartbeat runs every 5 min, giving a margin. */
export const HEARTBEAT_TTL = 600;

/** Abort the KV request if Layerbase doesn't respond within this window. */
const REQUEST_TIMEOUT_MS = 5000;

export interface HeartbeatResult {
  ok: boolean;
  latencyMs?: number;
}

export interface HeartbeatStatus {
  ok: boolean;
  lastHeartbeat?: string;
  latencyMs?: number;
}

/**
 * Race a promise against a timeout.  Resolves with the promise value or
 * rejects with a TimeoutError — never leaves the caller hanging.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms),
    ),
  ]);
}

/**
 * Perform a single heartbeat: SET the fixed key to the current timestamp
 * with a 600-second TTL.  This is the lightest possible write that keeps
 * the Valkey instance active.
 */
export async function performHeartbeat(): Promise<HeartbeatResult> {
  if (!isRedisAvailable) {
    logger.warn("[LAYERBASE_HEARTBEAT] failed — KV not configured");
    return { ok: false };
  }

  const start = Date.now();
  try {
    await withTimeout(
      redis.setex(HEARTBEAT_KEY, HEARTBEAT_TTL, String(Date.now())),
      REQUEST_TIMEOUT_MS,
    );
    const latencyMs = Date.now() - start;
    logger.info(`[LAYERBASE_HEARTBEAT] success duration=${latencyMs}ms`);
    return { ok: true, latencyMs };
  } catch {
    const latencyMs = Date.now() - start;
    logger.error(`[LAYERBASE_HEARTBEAT] failed duration=${latencyMs}ms`);
    return { ok: false };
  }
}

/**
 * Read the last heartbeat timestamp and measure read latency.
 * Used by the protected status endpoint — never exposes credentials.
 */
export async function getHeartbeatStatus(): Promise<HeartbeatStatus> {
  if (!isRedisAvailable) {
    return { ok: false };
  }

  const start = Date.now();
  try {
    const value = await withTimeout(
      redis.get<string>(HEARTBEAT_KEY),
      REQUEST_TIMEOUT_MS,
    );
    const latencyMs = Date.now() - start;
    if (value === null) {
      return { ok: false, latencyMs };
    }
    const ts = typeof value === "string" ? value : String(value);
    return {
      ok: true,
      lastHeartbeat: new Date(Number(ts)).toISOString(),
      latencyMs,
    };
  } catch {
    return { ok: false };
  }
}
