/**
 * Layerbase heartbeat endpoints.
 *
 *   GET /api/health/layerbase         — performs a heartbeat write
 *   GET /api/health/layerbase/status  — reads the last heartbeat timestamp
 *
 * Both endpoints are protected by CRON_HEARTBEAT_SECRET.  A request must
 * include either:
 *   Authorization: Bearer <CRON_HEARTBEAT_SECRET>
 *   X-Cron-Secret:  <CRON_HEARTBEAT_SECRET>
 *
 * Unauthenticated requests get a bare 401 — no information about whether
 * Layerbase is active is leaked.  Responses never include tokens, URLs, or
 * internal error details.
 */
import crypto from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { performHeartbeat, getHeartbeatStatus } from "../services/layerbaseHeartbeat";

const router: IRouter = Router();

/** Timing-safe string comparison to prevent timing-based secret extraction. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verify the cron secret from either supported header.
 * Exported for unit testing.
 */
export function verifyCronSecret(req: Request): boolean {
  const expected = process.env.CRON_HEARTBEAT_SECRET?.trim();
  // If no secret is configured, deny everything (fail-closed).
  if (!expected) return false;

  const authHeader = req.header("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (safeEqual(token, expected)) return true;
  }

  const cronHeader = req.header("x-cron-secret");
  if (cronHeader) {
    if (safeEqual(cronHeader.trim(), expected)) return true;
  }

  return false;
}

// ── Heartbeat trigger (called by external cron every 5 min) ──────────────────
router.get("/health/layerbase", async (req: Request, res: Response) => {
  if (!verifyCronSecret(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const result = await performHeartbeat();
  if (result.ok) {
    res.status(200).json({ ok: true });
  } else {
    res.status(503).json({ ok: false });
  }
});

// ── Heartbeat status (protected, safe info only) ────────────────────────────
router.get("/health/layerbase/status", async (req: Request, res: Response) => {
  if (!verifyCronSecret(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const status = await getHeartbeatStatus();
  if (status.ok) {
    res.status(200).json({
      ok: true,
      lastHeartbeat: status.lastHeartbeat,
      latencyMs: status.latencyMs,
    });
  } else {
    res.status(503).json({ ok: false });
  }
});

export default router;
