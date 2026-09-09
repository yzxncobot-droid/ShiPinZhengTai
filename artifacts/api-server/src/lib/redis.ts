/**
 * Cache & session store — backed by an in-memory TTL cache (no external
 * Redis/Valkey/Layerbase service required).
 *
 * All data here is EPHEMERAL: lost on server restart. Neon PostgreSQL
 * remains the single source of truth for all persistent data.
 *
 * The API surface is identical to the previous Redis/Valkey-backed version
 * so every consumer (auth, maintenance, rate-limit, analytics, leaderboard,
 * chat-rooms, etc.) works unchanged.
 */
import { logger } from "./logger";
import { memoryCache } from "./cache/memory-cache";

// ── Availability flags ─────────────────────────────────────────────────────────

/** Always true — in-memory cache needs no external service. */
export const isRedisAvailable = true;

/** Always true — in-memory cache supports atomic incr/expire/ttl. */
export const isAtomicRedisAvailable = true;

// ── Client ────────────────────────────────────────────────────────────────────

/** In-memory cache instance (Redis-compatible API surface). */
export const redis = memoryCache;

logger.info("In-memory cache active (sessions, rate-limit, caching) — no external Redis/Valkey required");

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

/** Store a new session in the in-memory cache. */
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

/** Increment view counter and return the new count. */
export async function incrementVideoViews(videoId: string): Promise<number> {
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
