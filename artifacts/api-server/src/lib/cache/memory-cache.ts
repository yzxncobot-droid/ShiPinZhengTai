/**
 * In-memory cache with TTL support — replaces Layerbase Valkey / Redis.
 *
 * All data is EPHEMERAL: lost on server restart. Use Neon PostgreSQL
 * for persistent data (users, wallet, payments, MTProto session, etc.).
 *
 * This cache is used for:
 *   - JWT session store (session validation, force-logout markers)
 *   - User cache (5-min TTL)
 *   - Rate limiting counters
 *   - Maintenance mode cache (15-s TTL)
 *   - Analytics / leaderboard cache
 *   - Temp tokens (password reset, email verification)
 *   - Video view buffer
 *   - Chat typing indicators (5-s TTL)
 *
 * The API surface matches the Redis commands we used via @upstash/redis
 * so `redis.ts` can delegate here without changing any consumer.
 */
import { logger } from "../logger";

interface CacheEntry {
  value: string;
  expiresAt: number; // unix ms; 0 = no expiry (permanent until deleted)
}

const SWEEP_INTERVAL_MS = 60_000; // 1 minute
const MAX_ENTRIES = 10_000;

const store = new Map<string, CacheEntry>();

// ── Periodic cleanup of expired entries ──────────────────────────────────────
let sweepTimer: ReturnType<typeof setInterval> | null = null;

function startSweep(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of store) {
      if (entry.expiresAt > 0 && entry.expiresAt <= now) {
        store.delete(key);
        removed++;
      }
    }
    if (removed > 0) {
      logger.debug({ removed, remaining: store.size }, "[CACHE] swept expired entries");
    }
  }, SWEEP_INTERVAL_MS);
  // Don't keep the event loop alive just for cache cleanup.
  sweepTimer.unref?.();
}

startSweep();

function isExpired(entry: CacheEntry): boolean {
  return entry.expiresAt > 0 && entry.expiresAt <= Date.now();
}

/** Convert a glob pattern (e.g. `typing:room1:*`) to a RegExp. */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp("^" + escaped.replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
}

// ── Redis-compatible in-memory cache ──────────────────────────────────────────

export const memoryCache = {
  async get<T = string>(key: string): Promise<T | null> {
    const entry = store.get(key);
    if (!entry) return null;
    if (isExpired(entry)) {
      store.delete(key);
      return null;
    }
    return entry.value as unknown as T;
  },

  async setex(key: string, ttl: number, value: string): Promise<string> {
    // Evict an expired entry if we're at capacity.
    if (store.size >= MAX_ENTRIES) {
      for (const [k, e] of store) {
        if (e.expiresAt > 0 && e.expiresAt <= Date.now()) {
          store.delete(k);
          break;
        }
      }
    }
    store.set(key, {
      value,
      expiresAt: ttl > 0 ? Date.now() + ttl * 1000 : 0,
    });
    return "OK";
  },

  /** SET with optional expiry (used by chat typing indicators). */
  async set(key: string, value: string, opts?: { ex?: number }): Promise<string> {
    return this.setex(key, opts?.ex ?? 0, value);
  },

  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      if (store.delete(key)) count++;
    }
    return count;
  },

  async incr(key: string): Promise<number> {
    const entry = store.get(key);
    let current = 0;
    if (entry && !isExpired(entry)) {
      current = parseInt(entry.value, 10) || 0;
    }
    current++;
    const existing = store.get(key);
    store.set(key, {
      value: String(current),
      expiresAt: existing?.expiresAt ?? 0,
    });
    return current;
  },

  async expire(key: string, seconds: number): Promise<number> {
    const entry = store.get(key);
    if (!entry || isExpired(entry)) return 0;
    entry.expiresAt = seconds > 0 ? Date.now() + seconds * 1000 : 0;
    return 1;
  },

  async ttl(key: string): Promise<number> {
    const entry = store.get(key);
    if (!entry) return -2;
    if (isExpired(entry)) {
      store.delete(key);
      return -2;
    }
    if (entry.expiresAt === 0) return -1;
    return Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000));
  },

  async ping(): Promise<string> {
    return "PONG";
  },

  /** Scan for keys matching a glob pattern (used by chat typing indicators). */
  async keys(pattern: string): Promise<string[]> {
    const regex = globToRegex(pattern);
    const result: string[] = [];
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.expiresAt > 0 && entry.expiresAt <= now) {
        store.delete(key);
        continue;
      }
      if (regex.test(key)) result.push(key);
    }
    return result;
  },

  /** Clear all entries (for testing). */
  clear(): void {
    store.clear();
  },

  /** Current entry count (for monitoring / health checks). */
  get size(): number {
    return store.size;
  },
};
