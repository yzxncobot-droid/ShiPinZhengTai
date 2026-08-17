import { Request, Response, NextFunction } from "express";
import { redis, keys, TTL } from "../lib/redis";
import { logger } from "../lib/logger";

interface RateLimitOptions {
  /** Maximum requests allowed in the window. */
  max: number;
  /** Window duration in seconds. */
  windowSeconds?: number;
  /** Endpoint label used in the Redis key (e.g. "auth:login"). */
  endpoint: string;
  /** Custom message returned on 429. */
  message?: string;
}

/**
 * Redis-backed sliding-window rate limiter.
 * Identifies clients by IP (falls back to "unknown").
 */
export function rateLimit(opts: RateLimitOptions) {
  const {
    max,
    windowSeconds = TTL.RATE_LIMIT,
    endpoint,
    message = "Too many requests. Please try again later.",
  } = opts;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
      req.ip ??
      "unknown";
    const key = keys.rateLimit(ip, endpoint);

    try {
      const current = await redis.incr(key);
      if (current === 1) {
        // Set TTL only on first increment so the window resets naturally
        await redis.expire(key, windowSeconds);
      }
      if (current > max) {
        const ttl = await redis.ttl(key);
        res.set("Retry-After", String(ttl));
        res.status(429).json({ error: message, retryAfter: ttl });
        return;
      }
      res.set("X-RateLimit-Limit", String(max));
      res.set("X-RateLimit-Remaining", String(Math.max(0, max - current)));
    } catch (err) {
      // If Redis is unavailable, log and allow the request through
      logger.warn({ err, endpoint }, "Rate-limit check failed — allowing request");
    }

    next();
  };
}

// ── Pre-built limiters ────────────────────────────────────────────────────────

/** Strict limiter for auth endpoints (login / register). */
export const authRateLimit = rateLimit({
  max: 10,
  windowSeconds: 60,
  endpoint: "auth",
  message: "Terlalu banyak percobaan login. Coba lagi dalam 1 menit.",
});

/** General API rate limiter (applied per-endpoint as needed). */
export const apiRateLimit = rateLimit({
  max: 100,
  windowSeconds: 60,
  endpoint: "api",
});

/** Strict limiter for upload endpoints. */
export const uploadRateLimit = rateLimit({
  max: 20,
  windowSeconds: 60,
  endpoint: "upload",
  message: "Upload rate limit reached. Please wait before trying again.",
});

/** Prevent QRIS creation/status polling from being abused or creating duplicate charges. */
export const qrisRateLimit = rateLimit({
  max: 30,
  windowSeconds: 60,
  endpoint: "qris",
  message: "Terlalu banyak permintaan QRIS. Coba lagi sebentar.",
});
