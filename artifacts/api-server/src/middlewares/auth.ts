import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { getSession, getCachedUser, cacheUser, isRedisAvailable } from "../lib/redis";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

// Prefer JWT_SECRET if set; fall back to SESSION_SECRET for backward compat.
const JWT_SECRET = process.env.JWT_SECRET ?? process.env.SESSION_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET (or SESSION_SECRET) environment variable is required");
}

export interface JwtPayload {
  /** UUID of the authenticated user. */
  userId: string;
  role: string;
  /** JWT ID — used as the Redis session key for invalidation on logout. */
  jti: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/**
 * Resolve the current role and ban status for a user.
 *
 * The JWT role is stamped at login time and can become stale if an owner
 * promotes (or demotes) the account afterwards.  This helper always fetches
 * the live role from the short-TTL user cache (invalidated on every role/ban
 * change) or falls back to a single DB row lookup.  The result is then
 * re-cached so subsequent requests in the same window are fast.
 *
 * Returns null when the user no longer exists in the database.
 */
async function resolveCurrentUser(
  userId: string,
  jwtRole: string,
): Promise<{ role: string; isBanned: boolean } | null> {
  // 1. Try the user cache first (5-min TTL, invalidated on role/ban changes)
  try {
    const cached = await getCachedUser(userId);
    if (cached && typeof cached === "object") {
      const u = cached as any;
      if (u.role) {
        return { role: u.role, isBanned: !!u.isBanned };
      }
    }
  } catch {
    // Redis unavailable — fall through to DB
  }

  // 2. Cache miss or missing role field — fetch from DB
  try {
    const [dbUser] = await db
      .select({ role: usersTable.role, isBanned: usersTable.isBanned })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (!dbUser) return null;

    // Re-populate cache so the next request in this window skips the DB hop
    await cacheUser(userId, { role: dbUser.role, isBanned: dbUser.isBanned }).catch(() => {});

    return { role: dbUser.role, isBanned: dbUser.isBanned };
  } catch (err) {
    logger.warn({ userId, err }, "authenticate: DB role lookup failed, falling back to JWT role");
    // If DB is unavailable, fall back to the JWT role so we don't deny valid requests
    return { role: jwtRole, isBanned: false };
  }
}

/** Extract and verify a Bearer JWT, then check that the session is still active in Redis. */
export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = authHeader.slice(7);
  let payload: JwtPayload;
  try {
    payload = jwt.verify(token, JWT_SECRET!) as unknown as JwtPayload;
  } catch {
    res.status(401).json({ error: "Invalid token" });
    return;
  }

  // Check Redis session — null means the session was invalidated (logout).
  // Skip this check entirely when Redis is not configured so that the server
  // works without Upstash credentials (JWT-only auth mode).
  if (payload.jti && isRedisAvailable) {
    try {
      const session = await getSession(payload.jti);
      if (!session) {
        res.status(401).json({ error: "Session expired or logged out" });
        return;
      }
    } catch {
      // If Redis is unreachable at runtime, fall back to JWT-only validation
    }
  }

  // Always resolve the *current* role from the user cache / DB so that role
  // promotions take effect on the very next request — without requiring
  // re-login.  The cache is invalidated on every role/ban change, so this is
  // both correct and cheap for repeat requests within the 5-minute window.
  const current = await resolveCurrentUser(payload.userId, payload.role);

  if (!current) {
    // User was deleted after the token was issued
    res.status(401).json({ error: "User not found" });
    return;
  }

  if (current.isBanned) {
    res.status(403).json({ error: "Akun kamu diblokir. Hubungi admin untuk info lebih lanjut." });
    return;
  }

  if (current.role !== payload.role) {
    logger.info(
      { userId: payload.userId, jwtRole: payload.role, currentRole: current.role },
      "authenticate: role updated from DB (JWT had stale role)",
    );
  }

  req.user = { ...payload, role: current.role };
  next();
}

/** Same as authenticate but does not block if no/invalid token — just skips setting req.user. */
export async function optionalAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    next();
    return;
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET!) as unknown as JwtPayload;
    if (payload.jti && isRedisAvailable) {
      try {
        const session = await getSession(payload.jti);
        if (!session) {
          next();
          return;
        }
      } catch {
        // Redis unavailable — trust JWT
      }
    }

    // Resolve current role (best-effort; errors are ignored for optional auth)
    const current = await resolveCurrentUser(payload.userId, payload.role).catch(() => null);
    if (current && !current.isBanned) {
      req.user = { ...payload, role: current.role };
    }
  } catch {
    // ignore invalid tokens
  }
  next();
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      logger.warn(
        {
          userId: req.user.userId,
          userRole: req.user.role,
          requiredRoles: roles,
          method: req.method,
          url: req.url,
        },
        "403 Forbidden — role mismatch",
      );
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}

/** Sign a JWT with a unique jti for Redis session tracking. */
export function signToken(userId: string, role: string): { token: string; jti: string } {
  const jti = crypto.randomUUID();
  const token = jwt.sign({ userId, role, jti }, JWT_SECRET!, { expiresIn: "30d" });
  return { token, jti };
}
