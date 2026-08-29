import { logger } from "./logger";
import { layerbaseKV, isLayerbaseKVAvailable } from "./layerbase-kv";

// ── Availability flags ─────────────────────────────────────────────────────────

/**
 * True when Layerbase Valkey credentials are present.
 * Used by the auth middleware to skip session-store checks when KV is
 * not configured (so the server degrades gracefully instead of crashing).
 */
export const isRedisAvailable = isLayerbaseKVAvailable;

/**
 * Atomic operations (INCR/EXPIRE) are disabled to preserve the same behavior
 * as the previous Cloudflare KV backend (which did not support them).
 * Rate limiting and view-buffer counters remain no-ops.
 */
export const isAtomicRedisAvailable = false;

// ── Client interface ──────────────────────────────────────────────────────────

/** Minimal interface that matches the Redis API surface we use. */
interface RedisLike {
  get<T = string>(key: string): Promise<T | null>;
  setex(key: string, ttl: number, value: string): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  incr(key: string): Promise<number>;
  /** Set expiry in seconds on an existing key. */
  expire(key: string, seconds: number): Promise<number>;
  /** Returns the remaining TTL in seconds, or -2 if key does not exist. */
  ttl(key: string): Promise<number>;
  /** Ping the store — returns "PONG". */
  ping(): Promise<string>;
}

// ── No-op stub (used when KV is not configured) ────────────────────────────────

const noopRedis: RedisLike = {
  get:    async () => null,
  setex:  async () => "OK",
  del:    async () => 0,
  incr:   async () => 1,
  expire: async () => 1,   // no-op: pretend the key has a TTL set
  ttl:    async () => 60,  // no-op: return 60 s so rate-limit Retry-After is sane
  ping:   async () => "PONG",
};

// ── Real client (Layerbase Valkey) ───────────────────────────────────────────

let _client: RedisLike = noopRedis;

if (isLayerbaseKVAvailable && layerbaseKV) {
  _client = layerbaseKV as unknown as RedisLike;
  logger.info("Layerbase Valkey connected for sessions/cache");
} else {
  logger.warn(
    "KV_REST_API_URL / KV_REST_API_TOKEN not set — " +
    "running without KV. Session invalidation, caching, and view " +
    "buffering are disabled. All other features work normally.",
  );
}

/** Access the KV client (real or no-op). */
export const redis: RedisLike = _client;

// ── TTL constants ─────────────────────────────────────────────────────────────
export const TTL = {
  SESSION: 60 * 60 * 24 * 30,   // 30 days (matches JWT expiry)
  USER_CACHE: 60 * 5,            // 5 minutes
  ANALYTICS: 60 * 5,             // 5 minutes
  LEADERBOARD: 60 * 5,           // 5 minutes
  SETTINGS: 60 * 10,             // 10 minutes
  TEMP_TOKEN: 60 * 60,           // 1 hour (password reset, verification)
  RATE_LIMIT: 60,                // 1 minute window
} as const;

// ── Key builders ──────────────────────────────────────────────────────────────
export const keys = {
  session: (jti: string) => `session:${jti}`,
  userCache: (userId: string) => `cache:user:${userId}`,
  analytics: (kind: string) => `cache:analytics:${kind}`,
  leaderboard: (period: string) => `cache:leaderboard:${period}`,
  settings: () => `cache:settings`,
  videoViews: (videoId: string) => `views:video:${videoId}`,
  rateLimit: (ip: string, endpoint: string) => `rl:${endpoint}:${ip}`,
  tempToken: (type: string, token: string) => `token:${type}:${token}`,
};

// ── Session management ────────────────────────────────────────────────────────

export interface SessionData {
  userId: string;
  role: string;
  username: string;
  createdAt: number;
}

/** Store a new session in KV. */
export async function createSession(jti: string, data: SessionData): Promise<void> {
  await redis.setex(keys.session(jti), TTL.SESSION, JSON.stringify(data));
}

/** Retrieve session data (returns null if expired or invalidated). */
export async function getSession(jti: string): Promise<SessionData | null> {
  const raw = await redis.get<string>(keys.session(jti));
  if (!raw) return null;
  try {
    return typeof raw === "string" ? JSON.parse(raw) : (raw as SessionData);
  } catch {
    return null;
  }
}

/** Invalidate a session (logout). */
export async function deleteSession(jti: string): Promise<void> {
  await redis.del(keys.session(jti));
}

// ── User cache ────────────────────────────────────────────────────────────────

export async function cacheUser(userId: string, data: unknown): Promise<void> {
  await redis.setex(keys.userCache(userId), TTL.USER_CACHE, JSON.stringify(data));
}

export async function getCachedUser(userId: string): Promise<unknown | null> {
  const raw = await redis.get<string>(keys.userCache(userId));
  if (!raw) return null;
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

export async function invalidateUserCache(userId: string): Promise<void> {
  await redis.del(keys.userCache(userId));
}

// ── Generic cache helpers ─────────────────────────────────────────────────────

export async function getOrSet<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const cached = await redis.get<string>(key);
  if (cached !== null) {
    try {
      return (typeof cached === "string" ? JSON.parse(cached) : cached) as T;
    } catch {
      // fall through to fetcher
    }
  }
  const fresh = await fetcher();
  await redis.setex(key, ttlSeconds, JSON.stringify(fresh));
  return fresh;
}

export async function invalidateCache(key: string): Promise<void> {
  await redis.del(key);
}

// ── Temporary tokens (password reset, email verification) ─────────────────────

export async function storeTempToken(
  type: string,
  token: string,
  payload: unknown,
  ttlSeconds = TTL.TEMP_TOKEN,
): Promise<void> {
  await redis.setex(keys.tempToken(type, token), ttlSeconds, JSON.stringify(payload));
}

export async function consumeTempToken(type: string, token: string): Promise<unknown | null> {
  const key = keys.tempToken(type, token);
  const raw = await redis.get<string>(key);
  if (!raw) return null;
  await redis.del(key); // one-time use
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

// ── Video view counter ────────────────────────────────────────────────────────

/** Increment view counter and return the new count (always 0 without atomic support). */
export async function incrementVideoViews(videoId: string): Promise<number> {
  if (!isAtomicRedisAvailable) return 0;
  return (await redis.incr(keys.videoViews(videoId))) as number;
}

/** Get buffered view count (returns 0 if no buffer exists). */
export async function getBufferedViews(videoId: string): Promise<number> {
  const val = await redis.get<number>(keys.videoViews(videoId));
  return val ?? 0;
}

/** Reset the view counter after flushing to the DB. */
export async function resetVideoViewBuffer(videoId: string): Promise<void> {
  await redis.del(keys.videoViews(videoId));
}

// ── Force logout ──────────────────────────────────────────────────────────────

/**
 * Store a force-logout marker for a user.
 * The auth middleware checks this and rejects tokens issued before this timestamp.
 * TTL = 31 days (slightly longer than JWT expiry so all outstanding tokens are covered).
 */
export async function deleteAllUserSessions(userId: string): Promise<void> {
  await redis.setex(`force_logout:${userId}`, 60 * 60 * 24 * 31, String(Date.now()));
  await invalidateUserCache(userId);
}

/** Check if a token (by its iat — issued-at unix seconds) has been force-logged out. */
export async function isForceLoggedOut(userId: string, iatSeconds: number): Promise<boolean> {
  const raw = await redis.get<string>(`force_logout:${userId}`);
  if (!raw) return false;
  const ts = parseInt(typeof raw === "string" ? raw : String(raw));
  return !isNaN(ts) && iatSeconds * 1000 < ts;
}
