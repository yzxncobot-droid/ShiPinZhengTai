import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { getSession } from "../lib/redis";

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
    payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    res.status(401).json({ error: "Invalid token" });
    return;
  }

  // Check Redis session — null means the session was invalidated (logout)
  if (payload.jti) {
    try {
      const session = await getSession(payload.jti);
      if (!session) {
        res.status(401).json({ error: "Session expired or logged out" });
        return;
      }
    } catch {
      // If Redis is unreachable, fall back to JWT-only validation
    }
  }

  req.user = payload;
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
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
    if (payload.jti) {
      try {
        const session = await getSession(payload.jti);
        if (session) req.user = payload;
      } catch {
        req.user = payload; // Redis unavailable — trust JWT
      }
    } else {
      req.user = payload;
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
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}

/** Sign a JWT with a unique jti for Redis session tracking. */
export function signToken(userId: string, role: string): { token: string; jti: string } {
  const jti = crypto.randomUUID();
  const token = jwt.sign({ userId, role, jti }, JWT_SECRET, { expiresIn: "30d" });
  return { token, jti };
}
