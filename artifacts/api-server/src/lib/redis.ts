import { Redis } from "@upstash/redis";

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  throw new Error("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set");
}

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

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

/** Store a new session in Redis. */
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

/** Increment Redis view counter and return the new count. */
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
