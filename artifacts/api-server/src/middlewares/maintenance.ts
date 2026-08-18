/**
 * Maintenance Mode Middleware
 *
 * Checks maintenance_enabled from the settings table (cached in Redis for
 * 15 s).  When enabled, every non-owner request to a protected API route
 * returns HTTP 503 JSON.  Excluded paths: /api/auth/*, /api/settings/maintenance-status.
 */
import { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { settingsTable } from "@workspace/db";
import { redis, TTL } from "../lib/redis";
import { logger } from "../lib/logger";

const CACHE_KEY = "cache:maintenance:status";
const CACHE_TTL = 15; // seconds

/** Read maintenance state — Redis-cached for 15 s. */
async function getMaintenanceEnabled(): Promise<boolean> {
  try {
    const cached = await redis.get<string>(CACHE_KEY);
    if (cached !== null) {
      return cached === "1" || cached === "true";
    }
  } catch {
    // Redis miss — fall through to DB
  }

  try {
    const [row] = await db.select({ maintenanceEnabled: settingsTable.maintenanceEnabled })
      .from(settingsTable).limit(1);

    const enabled = row?.maintenanceEnabled ?? false;
    await redis.setex(CACHE_KEY, CACHE_TTL, enabled ? "1" : "0").catch(() => {});
    return enabled;
  } catch (err) {
    logger.warn({ err }, "[maintenance] DB lookup failed — allowing request");
    return false;
  }
}

/** Bust the maintenance cache immediately (called after owner saves settings). */
export async function bustMaintenanceCache(): Promise<void> {
  await redis.del(CACHE_KEY).catch(() => {});
}

/**
 * Middleware factory.
 *
 * Usage in app.ts:
 *   app.use("/api", maintenanceGuard(), router);
 *
 * Paths excluded from the guard:
 *   - /api/auth/*          (login / logout always accessible)
 *   - /api/settings/maintenance-status  (frontend polls this)
 *   - /api/health          (health checks)
 */
export function maintenanceGuard() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const path = req.path;

    // Always allow these paths regardless of maintenance state
    const allowed =
      path.startsWith("/auth/") ||
      path === "/auth" ||
      path === "/health" ||
      path.startsWith("/health") ||
      path === "/settings/maintenance-status" ||
      path.startsWith("/webhooks/temanqris");

    if (allowed) {
      next();
      return;
    }

    let enabled: boolean;
    try {
      enabled = await getMaintenanceEnabled();
    } catch {
      next();
      return;
    }

    if (!enabled) {
      next();
      return;
    }

    // Maintenance is ON — check if the caller is an owner
    const role = (req as any).user?.role;
    if (role === "owner") {
      next();
      return;
    }

    // Non-owner (or unauthenticated) — 503
    res.status(503).json({
      success: false,
      code: "MAINTENANCE",
      message: "Situs sedang dalam pemeliharaan. Silakan coba beberapa saat lagi.",
    });
  };
}
