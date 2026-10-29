/**
 * Telegram Video Storage & Streaming — API routes.
 *
 * All endpoints are namespaced to avoid conflicts with existing routes:
 *   Admin:    /api/admin/telegram/...
 *   Public:   /api/telegram-videos/...
 *   Webhook:  /api/telegram/webhook
 *
 * Uses ONLY TELEGRAM_BOT_TOKEN — no API ID, API Hash, or Session required.
 * No existing route is modified or replaced.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import {
  telegramSourcesTable, telegramVideosTable, telegramSyncLogsTable,
  telegramImportLogsTable, usersTable, userSubscriptionsTable,
} from "@workspace/db";
import { eq, and, desc, ilike, sql, inArray } from "drizzle-orm";
import { TELEGRAM_VIDEO_PUBLIC_STATUSES } from "@workspace/db";
import { authenticate, optionalAuth, requireRole } from "../middlewares/auth";
import { logger } from "../lib/logger";
import {
  isTelegramConfigured, isLocalBotApiConfigured, checkLocalBotApiHealth,
  refreshLocalBotApiHealth,
  testConnection, getBotInfo, testBotApi, getFileInfo, getFileUrl,
  setWebhook, getWebhookInfo, deleteWebhook,
} from "../lib/telegram/client";
import {
  normalizeTelegramWebhookEndpoint,
  resolveTelegramWebhookUrl,
} from "../lib/telegram/webhook-url";
import {
  processIncomingUpdate, startQueueProcessor, getQueueStats,
  retryImportLog, syncSource, getTelegramErrorDiagnostics,
} from "../lib/telegram/indexer";
import { getVideoContentType, streamTelegramVideo } from "../lib/telegram/streamer";
import { enqueueStream, getStreamQueueStats } from "../lib/telegram/stream-queue";
import { getQueueStats as getVideoQueueStats, getAllProgress as getVideoQueueProgress } from "../lib/telegram/video-processing-queue";
import { createStreamTicket, verifyStreamTicket } from "../lib/telegram/stream-tickets";
import {
  isMtProtoConfigured, isMtProtoReady, getMtProtoStatus, initMtProto,
  markMtProtoSkipped,
} from "../lib/telegram/mtproto";

const router = Router();

// Start the import queue processor when the module loads.
startQueueProcessor();

// Initialize MTProto client (best-effort, non-blocking). If it fails, Bot API
// continues to work for files ≤20 MB. MTProto is needed for files >20 MB.
//
// When a Local Bot API Server is configured AND healthy, skip MTProto — both
// use the same TELEGRAM_API_ID/TELEGRAM_API_HASH and Telegram rejects duplicate
// auth keys with AUTH_KEY_DUPLICATED. But when the local server is configured
// but NOT healthy (unreachable, missing credentials), initialize MTProto so
// large-file streaming (>20 MB) still works. The health check is async, so
// this runs as an IIFE; until it resolves, isMtProtoReady() returns false.
if (isLocalBotApiConfigured()) {
  (async () => {
    const healthy = await refreshLocalBotApiHealth();
    if (healthy) {
      logger.info(
        "[TELEGRAM] Local Bot API Server healthy — skipping MTProto initialization to avoid AUTH_KEY_DUPLICATED conflict. Local Bot API supports files up to 2 GB.",
      );
      markMtProtoSkipped();
    } else {
      logger.warn(
        "[TELEGRAM] Local Bot API Server configured but NOT healthy — initializing MTProto for large-file streaming (>20 MB).",
      );
      initMtProto().catch((err) => {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          "[TELEGRAM] MTProto initialization failed (non-fatal) — Bot API continues to work for files ≤20 MB",
        );
      });
    }
  })();
} else {
  initMtProto().catch((err) => {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[TELEGRAM] MTProto initialization failed (non-fatal) — Bot API continues to work",
    );
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Check if a user has access to a premium Telegram video.
 * Reuses the existing subscription system — does NOT bypass premium.
 * Free videos are accessible to any authenticated user.
 */
async function checkTelegramVideoAccess(
  userId: string | undefined,
  video: any,
): Promise<boolean> {
  if (!video.isPremium) return true;
  if (!userId) return false;

  const [user] = await db.select({ role: usersTable.role })
    .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) return false;
  if (user.role === "admin" || user.role === "owner") return true;

  const now = new Date();
  const [sub] = await db.select()
    .from(userSubscriptionsTable)
    .where(and(
      eq(userSubscriptionsTable.userId, userId),
      eq(userSubscriptionsTable.isActive, true),
      sql`${userSubscriptionsTable.endDate} >= ${now}`,
    ))
    .limit(1);

  return !!sub;
}

/**
 * Stream authorization for GET /telegram-videos/:id/stream.
 *
 * Accepts EITHER:
 *   A. a normal Bearer-authenticated request (verified by the standard
 *      authenticate middleware), or
 *   B. a valid short-lived playback ticket (?ticket=..., issued by the
 *      stream-ticket endpoint after full auth + premium access checks).
 *
 * Requests with neither are rejected with 401 — the endpoint is never public
 * and premium protection stays fully enforced (the route re-checks access
 * via checkTelegramVideoAccess for every request).
 */
async function streamAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  // A. Normal authenticated request with the Authorization header.
  if (req.headers.authorization?.startsWith("Bearer ")) {
    await authenticate(req, res, next);
    return;
  }

  // B. Short-lived playback ticket.
  const ticket = req.query.ticket;
  if (typeof ticket !== "string" || !ticket) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const payload = verifyStreamTicket(ticket);
  if (!payload || payload.videoId !== req.params.id) {
    logger.info(
      { videoId: req.params.id },
      "[TELEGRAM STREAM] ticket invalid, expired, or video mismatch",
    );
    res.status(401).json({ error: "Invalid or expired stream ticket" });
    return;
  }

  // The ticket proves the user had access when it was issued; re-verify the
  // user still exists and is not banned (tickets can outlive a ban).
  const [u] = await db.select({ isBanned: usersTable.isBanned })
    .from(usersTable).where(eq(usersTable.id, payload.userId)).limit(1);
  if (!u || u.isBanned) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  logger.info({ videoId: req.params.id }, "[TELEGRAM STREAM] ticket validated");
  // Minimal identity for the access check — checkTelegramVideoAccess
  // re-resolves the live role from the DB for premium checks, so the
  // placeholder role is never trusted.
  req.user = { userId: payload.userId, role: "user", jti: "stream-ticket" };
  next();
}

// ═══════════════════════════════════════════════════════════════════════════
// WEBHOOK — public, no auth (Telegram sends updates here)
// ═══════════════════════════════════════════════════════════════════════════

router.post("/telegram/webhook", async (req, res) => {
  const update = req.body || {};
  const updateType = update.message ? "message" : update.channel_post ? "channel_post"
    : update.edited_message ? "edited_message" : update.edited_channel_post ? "edited_channel_post"
    : "unknown";
  const chatId = update.message?.chat?.id ?? update.channel_post?.chat?.id
    ?? update.edited_message?.chat?.id ?? update.edited_channel_post?.chat?.id ?? null;
  const messageId = update.message?.message_id ?? update.channel_post?.message_id
    ?? update.edited_message?.message_id ?? update.edited_channel_post?.message_id ?? null;
  logger.info(
    { updateId: update.update_id ?? null, updateType, chatId, messageId },
    "[TELEGRAM] Webhook received",
  );

  // Verify webhook secret if configured.
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (webhookSecret) {
    const headerSecret = req.headers["x-telegram-bot-api-secret-token"];
    if (headerSecret !== webhookSecret) {
      logger.warn("[TELEGRAM] Webhook secret mismatch — rejecting");
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  }

  // Persist the import log before acknowledging the webhook. Returning 5xx on
  // persistence failure lets Telegram redeliver the update; duplicate checks
  // and the video unique index make those retries idempotent.
  try {
    const result = await processIncomingUpdate(update);
    if (result.reason === "error") {
      res.status(500).json({ ok: false });
      return;
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    logger.error(
      getTelegramErrorDiagnostics(err),
      "[TELEGRAM] Webhook processing error",
    );
    res.status(500).json({ ok: false });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN ENDPOINTS — require admin/owner role
// ═══════════════════════════════════════════════════════════════════════════

// ── GET /api/admin/telegram/sources — list all sources ──────────────────────
router.get("/admin/telegram/sources", authenticate, requireRole("admin", "owner"), async (_req, res) => {
  try {
    logger.info({ userId: _req.user?.userId }, "[TELEGRAM_SOURCE][GET] Admin sources request");
    const sources = await db.select().from(telegramSourcesTable)
      .orderBy(desc(telegramSourcesTable.createdAt));
    logger.info({ sourceCount: sources.length }, "[TELEGRAM_SOURCE][GET] Success");
    res.json(sources);
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "[TELEGRAM_SOURCE][GET][ERROR] Failed to list sources",
    );
    res.status(500).json({ error: "Failed to list sources" });
  }
});

// ── POST /api/admin/telegram/sources — create a source ──────────────────────
router.post("/admin/telegram/sources", authenticate, requireRole("admin", "owner"), async (req, res) => {
  try {
    const { name, chatId, type, description, enabled = true } = req.body;

    if (!name?.trim()) { res.status(400).json({ error: "Source name is required" }); return; }
    if (!chatId?.trim()) { res.status(400).json({ error: "Telegram Chat ID is required" }); return; }
    if (type && !["GROUP", "CHANNEL"].includes(type)) {
      res.status(400).json({ error: "Type must be GROUP or CHANNEL" }); return;
    }

    const [existing] = await db.select().from(telegramSourcesTable)
      .where(eq(telegramSourcesTable.chatId, chatId.trim())).limit(1);
    if (existing) {
      res.status(409).json({ error: "A source with this Telegram Chat ID already exists" }); return;
    }

    // Premium is NO LONGER set at the Telegram Source level.
    // isPremium and defaultPrice are kept in the DB for backward compat but
    // are always false/null for new sources.
    const [source] = await db.insert(telegramSourcesTable).values({
      name: name.trim(),
      chatId: chatId.trim(),
      type: type || "CHANNEL",
      description: description?.trim() || null,
      enabled: enabled !== false,
      status: "UNKNOWN",
    }).returning();

    logger.info({ sourceId: source.id, name, chatId }, "[TELEGRAM] Source created");

    // Test connection immediately if configured.
    if (isTelegramConfigured()) {
      testConnection(chatId.trim()).then(async (result) => {
        await db.update(telegramSourcesTable).set({
          status: result.success ? "CONNECTED" : (result.disconnected ? "DISCONNECTED" : "ERROR"),
          lastConnectionCheck: new Date(),
          errorMessage: result.success ? null : result.errorMessage,
          ...(result.success && result.type ? { type: result.type as "GROUP" | "CHANNEL" } : {}),
          updatedAt: new Date(),
        }).where(eq(telegramSourcesTable.id, source.id));
      }).catch(() => {});
    }

    res.status(201).json(source);
  } catch (err) {
    logger.error({ err }, "POST /admin/telegram/sources failed");
    res.status(500).json({ error: "Failed to create source" });
  }
});

// ── GET /api/admin/telegram/sources/:id — get a source ─────────────────────
router.get("/admin/telegram/sources/:id", authenticate, requireRole("admin", "owner"), async (req, res) => {
  try {
    const [source] = await db.select().from(telegramSourcesTable)
      .where(eq(telegramSourcesTable.id, req.params.id as string)).limit(1);
    if (!source) { res.status(404).json({ error: "Source not found" }); return; }
    res.json(source);
  } catch (err) {
    logger.error({ err }, "GET /admin/telegram/sources/:id failed");
    res.status(500).json({ error: "Failed to get source" });
  }
});

// ── PATCH /api/admin/telegram/sources/:id — update a source ────────────────
router.patch("/admin/telegram/sources/:id", authenticate, requireRole("admin", "owner"), async (req, res) => {
  try {
    const { name, chatId, type, description, enabled } = req.body;

    const [existing] = await db.select().from(telegramSourcesTable)
      .where(eq(telegramSourcesTable.id, req.params.id as string)).limit(1);
    if (!existing) { res.status(404).json({ error: "Source not found" }); return; }

    // Premium is NO LONGER managed at the Telegram Source level.
    const updates: Record<string, any> = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name.trim();
    if (chatId !== undefined) updates.chatId = chatId.trim();
    if (type !== undefined) updates.type = type;
    if (description !== undefined) updates.description = description?.trim() || null;
    if (enabled !== undefined) updates.enabled = enabled;

    const [updated] = await db.update(telegramSourcesTable).set(updates)
      .where(eq(telegramSourcesTable.id, req.params.id as string)).returning();

    res.json(updated);
  } catch (err) {
    logger.error({ err }, "PATCH /admin/telegram/sources/:id failed");
    res.status(500).json({ error: "Failed to update source" });
  }
});

// ── DELETE /api/admin/telegram/sources/:id — delete a source ───────────────
router.delete("/admin/telegram/sources/:id", authenticate, requireRole("admin", "owner"), async (req, res) => {
  try {
    const [existing] = await db.select().from(telegramSourcesTable)
      .where(eq(telegramSourcesTable.id, req.params.id as string)).limit(1);
    if (!existing) { res.status(404).json({ error: "Source not found" }); return; }

    await db.delete(telegramSourcesTable)
      .where(eq(telegramSourcesTable.id, req.params.id as string));

    logger.info({ sourceId: req.params.id }, "[TELEGRAM] Source deleted");
    res.json({ message: "Source deleted" });
  } catch (err) {
    logger.error({ err }, "DELETE /admin/telegram/sources/:id failed");
    res.status(500).json({ error: "Failed to delete source" });
  }
});

// ── POST /api/admin/telegram/sources/:id/test — test connection ─────────────
router.post("/admin/telegram/sources/:id/test", authenticate, requireRole("admin", "owner"), async (req, res) => {
  try {
    const [source] = await db.select().from(telegramSourcesTable)
      .where(eq(telegramSourcesTable.id, req.params.id as string)).limit(1);
    if (!source) { res.status(404).json({ error: "Source not found" }); return; }

    if (!isTelegramConfigured()) {
      res.json({
        success: false,
        errorMessage: "TELEGRAM_BOT_TOKEN not configured. Set the TELEGRAM_BOT_TOKEN environment variable.",
      });
      return;
    }

    const result = await testConnection(source.chatId);

    await db.update(telegramSourcesTable).set({
      status: result.success ? "CONNECTED" : (result.disconnected ? "DISCONNECTED" : "ERROR"),
      lastConnectionCheck: new Date(),
      errorMessage: result.success ? null : result.errorMessage,
      ...(result.success && result.type ? { type: result.type as "GROUP" | "CHANNEL" } : {}),
      updatedAt: new Date(),
    }).where(eq(telegramSourcesTable.id, source.id));

    res.json(result);
  } catch (err) {
    logger.error({ err }, "POST /admin/telegram/sources/:id/test failed");
    res.status(500).json({ error: "Connection test failed" });
  }
});

// ── POST /api/admin/telegram/sources/:id/sync — refresh status + video count ──
router.post("/admin/telegram/sources/:id/sync", authenticate, requireRole("admin", "owner"), async (req, res) => {
  try {
    const [source] = await db.select().from(telegramSourcesTable)
      .where(eq(telegramSourcesTable.id, req.params.id as string)).limit(1);
    if (!source) { res.status(404).json({ error: "Source not found" }); return; }

    if (isTelegramConfigured()) {
      const testResult = await testConnection(source.chatId);
      await db.update(telegramSourcesTable).set({
        status: testResult.success ? "CONNECTED" : (testResult.disconnected ? "DISCONNECTED" : "ERROR"),
        lastConnectionCheck: new Date(),
        errorMessage: testResult.success ? null : testResult.errorMessage,
        updatedAt: new Date(),
      }).where(eq(telegramSourcesTable.id, source.id));
    }

    const result = await syncSource(source.id);
    res.json({
      message: "Sync completed",
      connected: result.connected,
      totalVideos: result.videoCount,
    });
  } catch (err) {
    logger.error({ err }, "POST /admin/telegram/sources/:id/sync failed");
    res.status(500).json({ error: "Sync failed" });
  }
});

// ── GET /api/admin/telegram/sources/:id/logs — sync logs ────────────────────
router.get("/admin/telegram/sources/:id/logs", authenticate, requireRole("admin", "owner"), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const logs = await db.select().from(telegramSyncLogsTable)
      .where(eq(telegramSyncLogsTable.telegramSourceId, req.params.id as string))
      .orderBy(desc(telegramSyncLogsTable.startedAt))
      .limit(limit);
    res.json(logs);
  } catch (err) {
    logger.error({ err }, "GET /admin/telegram/sources/:id/logs failed");
    res.status(500).json({ error: "Failed to get logs" });
  }
});

// ── PATCH /api/admin/telegram/videos/:id — update video (premium flag etc.) ─
router.patch("/admin/telegram/videos/:id", authenticate, requireRole("admin", "owner"), async (req, res) => {
  try {
    const { isPremium, price } = req.body;
    const updates: Record<string, any> = { updatedAt: new Date() };
    if (isPremium !== undefined) updates.isPremium = isPremium;
    if (price !== undefined) updates.price = price;

    const [updated] = await db.update(telegramVideosTable).set(updates)
      .where(eq(telegramVideosTable.id, req.params.id as string)).returning();

    if (!updated) { res.status(404).json({ error: "Video not found" }); return; }
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "PATCH /admin/telegram/videos/:id failed");
    res.status(500).json({ error: "Failed to update video" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// WEBHOOK MANAGEMENT — admin only
// ═══════════════════════════════════════════════════════════════════════════

// ── POST /api/admin/telegram/webhook/setup — set Telegram webhook ────────────
router.post("/admin/telegram/webhook/setup", authenticate, requireRole("admin", "owner"), async (req, res) => {
  try {
    if (!isTelegramConfigured()) {
      res.status(400).json({ error: "TELEGRAM_BOT_TOKEN not configured" });
      return;
    }

    // Use the same stable-public-URL policy as startup auto-registration.
    // An explicit URL is accepted only when it is an HTTPS production endpoint.
    const requestedUrl = typeof req.body.url === "string" ? req.body.url.trim() : "";
    const publicUrl = requestedUrl
      ? normalizeTelegramWebhookEndpoint(requestedUrl)
      : resolveTelegramWebhookUrl();

    if (requestedUrl && !publicUrl) {
      res.status(400).json({
        error: "Invalid webhook URL",
        detail: "Use the exact HTTPS /api/telegram/webhook endpoint on a stable public domain.",
      });
      return;
    }

    if (!publicUrl) {
      res.status(400).json({
        error: "No stable public webhook URL is configured.",
        detail: "Set PUBLIC_BASE_URL for a custom domain or run this setup from the published app.",
      });
      return;
    }

    const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET;

    await setWebhook(publicUrl, secretToken);

    // Verify that Telegram actually reports the expected webhook URL.
    const info = await getWebhookInfo();
    if (info.url !== publicUrl) {
      logger.error({ expected: publicUrl, actual: info.url }, "[TELEGRAM] Webhook URL mismatch after setWebhook");
      res.status(500).json({
        success: false,
        error: "Webhook URL mismatch",
        detail: `Expected ${publicUrl} but Telegram reports ${info.url || "(empty)"}`,
        webhookUrl: info.url,
      });
      return;
    }

    // If Telegram reports a last_error_message, surface it as a webhook error.
    if (info.lastErrorMessage) {
      logger.warn({ lastError: info.lastErrorMessage }, "[TELEGRAM] Webhook has last_error_message");
      res.json({
        success: true,
        warning: `Webhook set but Telegram reports an error: ${info.lastErrorMessage}`,
        webhookUrl: publicUrl,
        lastErrorMessage: info.lastErrorMessage,
        lastErrorDate: info.lastErrorDate || null,
        pendingUpdates: info.pendingUpdateCount,
      });
      return;
    }

    // Get bot info to show the username.
    const botInfo = await getBotInfo();

    logger.info({ url: publicUrl, bot: botInfo?.username }, "[TELEGRAM] Webhook set");
    res.json({
      success: true,
      webhookUrl: publicUrl,
      botUsername: botInfo?.username || null,
      pendingUpdates: info.pendingUpdateCount,
    });
  } catch (err) {
    logger.error({ err }, "POST /admin/telegram/webhook/setup failed");
    res.status(500).json({
      error: "Failed to set webhook",
      detail: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

// ── GET /api/admin/telegram/webhook/info — get webhook status ────────────────
router.get("/admin/telegram/webhook/info", authenticate, requireRole("admin", "owner"), async (_req, res) => {
  try {
    if (!isTelegramConfigured()) {
      res.json({ configured: false, url: "", pendingUpdateCount: 0 });
      return;
    }

    const info = await getWebhookInfo();
    res.json({
      configured: true,
      url: info.url,
      pendingUpdateCount: info.pendingUpdateCount,
      lastErrorDate: info.lastErrorDate || null,
      lastErrorMessage: info.lastErrorMessage || null,
      allowedUpdates: ["message", "channel_post", "edited_message", "edited_channel_post"],
      hasCustomCertificate: info.hasCustomCertificate || false,
    });
  } catch (err) {
    logger.error({ err }, "GET /admin/telegram/webhook/info failed");
    res.status(500).json({ error: "Failed to get webhook info" });
  }
});

// ── DELETE /api/admin/telegram/webhook — delete webhook ─────────────────────
router.delete("/admin/telegram/webhook", authenticate, requireRole("admin", "owner"), async (_req, res) => {
  try {
    if (!isTelegramConfigured()) {
      res.status(400).json({ error: "TELEGRAM_BOT_TOKEN not configured" });
      return;
    }

    await deleteWebhook();
    logger.info("[TELEGRAM] Webhook deleted");
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "DELETE /admin/telegram/webhook failed");
    res.status(500).json({ error: "Failed to delete webhook" });
  }
});

// ── GET /api/admin/telegram/webhook/test — diagnostic endpoint ──────────────
router.get("/admin/telegram/webhook/test", authenticate, requireRole("admin", "owner"), async (_req, res) => {
  const errors: string[] = [];

  // 1. TELEGRAM_BOT_TOKEN exists
  if (!isTelegramConfigured()) {
    // Still check the database even without a token — don't hide DB errors.
    let dbOk = false;
    try {
      await db.execute(sql`SELECT 1`);
      dbOk = true;
    } catch (err) {
      errors.push(`Database connection failed: ${err instanceof Error ? err.message : "Unknown"}`);
    }
    res.json({
      botApi: "error",
      webhook: "error",
      database: dbOk ? "ok" : "error",
      publicBaseUrl: process.env.PUBLIC_BASE_URL || null,
      webhookUrl: null,
      pendingUpdates: 0,
      errors: ["TELEGRAM_BOT_TOKEN not configured", ...errors],
    });
    return;
  }

  // 2. Telegram getMe succeeds (fresh call — never cached)
  let botApiOk = false;
  const botResult = await testBotApi();
  botApiOk = botResult.ok;
  if (!botResult.ok) errors.push(`getMe failed: ${botResult.error}`);

  // 3. Telegram getWebhookInfo succeeds
  let webhookOk = false;
  let webhookUrl = "";
  let pendingUpdates = 0;
  try {
    const info = await getWebhookInfo();
    webhookUrl = info.url;
    pendingUpdates = info.pendingUpdateCount;
    webhookOk = !!info.url;
    if (!info.url) errors.push("No webhook URL set");
    if (info.lastErrorMessage) errors.push(`Last webhook error: ${info.lastErrorMessage}`);
  } catch (err) {
    errors.push(`getWebhookInfo failed: ${err instanceof Error ? err.message : "Unknown"}`);
  }

  // 4-5. Webhook URL matches PUBLIC_BASE_URL + /api/telegram/webhook
  const expectedWebhookUrl = resolveTelegramWebhookUrl();
  if (expectedWebhookUrl && webhookUrl) {
    if (webhookUrl !== expectedWebhookUrl) {
      errors.push(`Webhook URL mismatch: expected ${expectedWebhookUrl}, got ${webhookUrl}`);
      webhookOk = false;
    }
  } else if (!expectedWebhookUrl && process.env.NODE_ENV === "production") {
    errors.push("No stable HTTPS webhook URL can be resolved for this deployment");
  }

  // 6. Webhook secret configured
  if (!process.env.TELEGRAM_WEBHOOK_SECRET) {
    errors.push("TELEGRAM_WEBHOOK_SECRET not configured");
  }

  // 7. Database connection works
  let dbOk = false;
  try {
    await db.execute(sql`SELECT 1`);
    dbOk = true;
  } catch (err) {
    errors.push(`Database connection failed: ${err instanceof Error ? err.message : "Unknown"}`);
  }

  res.json({
    botApi: botApiOk ? "ok" : "error",
    webhook: webhookOk ? "ok" : "error",
    database: dbOk ? "ok" : "error",
      publicBaseUrl: expectedWebhookUrl ? new URL(expectedWebhookUrl).origin : null,
    webhookUrl: webhookUrl || null,
    pendingUpdates,
    errors,
  });
});

// ── GET /api/admin/telegram/mtproto/health — MTProto diagnostic (admin-only) ─
router.get("/admin/telegram/mtproto/health", authenticate, requireRole("admin", "owner"), async (_req, res) => {
  try {
    const status = getMtProtoStatus();
    // Return only sanitized fields — never expose tokens, hashes, or session.
    res.json({
      enabled: status.enabled,
      connected: status.connected,
      authenticated: status.authenticated,
      sessionManagedAutomatically: status.sessionManagedAutomatically,
      authType: status.authType,
      apiIdConfigured: status.apiIdConfigured,
      state: status.state,
      error: status.error,
    });
  } catch (err) {
    logger.error({ err }, "GET /admin/telegram/mtproto/health failed");
    res.status(500).json({ error: "Failed to get MTProto status" });
  }
});

// ── GET /api/admin/telegram/bot-info — get bot username ──────────────────────
router.get("/admin/telegram/bot-info", authenticate, requireRole("admin", "owner"), async (_req, res) => {
  try {
    if (!isTelegramConfigured()) {
      res.json({ configured: false, username: null });
      return;
    }
    const botInfo = await getBotInfo();
    res.json({ configured: true, username: botInfo?.username || null });
  } catch (err) {
    logger.error({ err }, "GET /admin/telegram/bot-info failed");
    res.status(500).json({ error: "Failed to get bot info" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// IMPORT QUEUE — admin only
// ═══════════════════════════════════════════════════════════════════════════

// ── GET /api/admin/telegram/import-queue — list import log entries ──────────
router.get("/admin/telegram/import-queue", authenticate, requireRole("admin", "owner"), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const statusFilter = req.query.status as string;

    let query = db.select({
      log: telegramImportLogsTable,
      sourceName: telegramSourcesTable.name,
    }).from(telegramImportLogsTable)
      .leftJoin(telegramSourcesTable,
        eq(telegramImportLogsTable.telegramSourceId, telegramSourcesTable.id));

    if (statusFilter && ["pending", "processing", "completed", "failed"].includes(statusFilter)) {
      query = (query as any).where(eq(telegramImportLogsTable.status, statusFilter as "pending" | "processing" | "completed" | "failed"));
    }

    const rows = await (query as any).orderBy(desc(telegramImportLogsTable.createdAt)).limit(limit);

    // Parse metadata JSON to expose update_id, chat_id, type for admin logs.
    const enriched = rows.map((r: any) => {
      let parsed: any = null;
      try { parsed = r.log.metadata ? JSON.parse(r.log.metadata) : null; } catch {}
      return {
        ...r,
        log: {
          ...r.log,
          updateId: parsed?.updateId ?? null,
          chatId: parsed?.effectiveChatId ?? parsed?.rejectChatId ?? null,
          videoType: parsed?.videoType ?? null,
          fileSize: parsed?.fileSize ?? null,
          title: parsed?.caption || parsed?.fileName || null,
        },
      };
    });

    res.json(enriched);
  } catch (err) {
    logger.error({ err }, "GET /admin/telegram/import-queue failed");
    res.status(500).json({ error: "Failed to fetch import queue" });
  }
});

// ── GET /api/admin/telegram/import-queue/stats — queue statistics ───────────
router.get("/admin/telegram/import-queue/stats", authenticate, requireRole("admin", "owner"), async (_req, res) => {
  try {
    const stats = await getQueueStats();
    res.json(stats);
  } catch (err) {
    logger.error({ err }, "GET /admin/telegram/import-queue/stats failed");
    res.status(500).json({ error: "Failed to fetch queue stats" });
  }
});

// ── GET /api/admin/telegram/stream-queue/stats — stream queue statistics ──
router.get("/admin/telegram/stream-queue/stats", authenticate, requireRole("admin", "owner"), async (_req, res) => {
  try {
    res.json(getStreamQueueStats());
  } catch (err) {
    logger.error({ err }, "GET /admin/telegram/stream-queue/stats failed");
    res.status(500).json({ error: "Failed to fetch stream queue stats" });
  }
});

// ── GET /api/admin/telegram/video-queue/stats — staged video processing queue ─
router.get("/admin/telegram/video-queue/stats", authenticate, requireRole("admin", "owner"), async (_req, res) => {
  try {
    res.json(getVideoQueueStats());
  } catch (err) {
    logger.error({ err }, "GET /admin/telegram/video-queue/stats failed");
    res.status(500).json({ error: "Failed to fetch video queue stats" });
  }
});

// ── GET /api/admin/telegram/video-queue/progress — all job progress ─────────
router.get("/admin/telegram/video-queue/progress", authenticate, requireRole("admin", "owner"), async (_req, res) => {
  try {
    res.json(getVideoQueueProgress());
  } catch (err) {
    logger.error({ err }, "GET /admin/telegram/video-queue/progress failed");
    res.status(500).json({ error: "Failed to fetch video queue progress" });
  }
});

// ── POST /api/admin/telegram/import-queue/:id/retry — retry failed import ───
router.post("/admin/telegram/import-queue/:id/retry", authenticate, requireRole("admin", "owner"), async (req, res) => {
  try {
    await retryImportLog(req.params.id as string);
    res.json({ success: true, message: "Import queued for retry" });
  } catch (err) {
    logger.error({ err }, "POST /admin/telegram/import-queue/:id/retry failed");
    res.status(500).json({ error: "Failed to retry import" });
  }
});

// ── GET /api/admin/telegram/health — health check with real Telegram checks ──
router.get("/admin/telegram/health", authenticate, requireRole("admin", "owner"), async (_req, res) => {
  try {
    const [sources] = await db.select({
      total: sql<number>`count(*)::int`,
      connected: sql<number>`count(*) filter (where ${telegramSourcesTable.status} = 'CONNECTED')::int`,
      disconnected: sql<number>`count(*) filter (where ${telegramSourcesTable.status} = 'DISCONNECTED')::int`,
      error: sql<number>`count(*) filter (where ${telegramSourcesTable.status} = 'ERROR')::int`,
      syncing: sql<number>`count(*) filter (where ${telegramSourcesTable.status} = 'SYNCING')::int`,
    }).from(telegramSourcesTable);

    const [videos] = await db.select({
      total: sql<number>`count(*)::int`,
    }).from(telegramVideosTable);

    const queueStats = await getQueueStats();
    const streamQueueStats = getStreamQueueStats();

    const telegramApi = isTelegramConfigured();

    // ── Last successful video import (most recent completed import log) ────
    const [lastImport] = await db.select({
      createdAt: telegramImportLogsTable.createdAt,
      sourceName: telegramSourcesTable.name,
    }).from(telegramImportLogsTable)
      .leftJoin(telegramSourcesTable,
        eq(telegramImportLogsTable.telegramSourceId, telegramSourcesTable.id))
      .where(eq(telegramImportLogsTable.status, "completed"))
      .orderBy(desc(telegramImportLogsTable.createdAt))
      .limit(1);

    // ── Last failed import ──────────────────────────────────────────────────
    const [lastFailedImport] = await db.select({
      createdAt: telegramImportLogsTable.createdAt,
      errorMessage: telegramImportLogsTable.errorMessage,
    }).from(telegramImportLogsTable)
      .where(eq(telegramImportLogsTable.status, "failed"))
      .orderBy(desc(telegramImportLogsTable.createdAt))
      .limit(1);

    // ── Real webhook check via getWebhookInfo ────────────────────────────────
    let webhookStatus: "ok" | "error" | "not_configured" = "not_configured";
    let webhookInfo: { url: string; pendingUpdateCount: number; lastErrorMessage: string | null; lastErrorDate: number | null } | null = null;
    if (telegramApi) {
      try {
        const info = await getWebhookInfo();
        webhookInfo = {
          url: info.url,
          pendingUpdateCount: info.pendingUpdateCount,
          lastErrorMessage: info.lastErrorMessage || null,
          lastErrorDate: info.lastErrorDate || null,
        };
        // Webhook is OK if a URL is set and there's no recent error.
        webhookStatus = info.url && !info.lastErrorMessage ? "ok" : "error";
      } catch {
        webhookStatus = "error";
      }
    }

    // ── Real bot API check via fresh getMe (NOT cached) ──────────────────────
    // Never use "token exists" as proof — call getMe() every time.
    let botApiStatus: "ok" | "error" | "not_configured" = "not_configured";
    let botUsername: string | null = null;
    let botApiError: string | null = null;
    if (telegramApi) {
      const result = await testBotApi();
      if (result.ok) {
        botApiStatus = "ok";
        botUsername = result.username;
      } else {
        botApiStatus = "error";
        botApiError = result.error;
      }
    }

    // ── Real Local Bot API Server check ──────────────────────────────────────
    // Do NOT assume the server is OK just because TELEGRAM_API_BASE is set.
    // Perform a real connection test (getMe) against the configured endpoint.
    let localBotApiStatus: "ok" | "error" | "not_configured" = "not_configured";
    if (telegramApi && isLocalBotApiConfigured()) {
      localBotApiStatus = (await checkLocalBotApiHealth()) ? "ok" : "error";
    }

    // ── MTProto status ────────────────────────────────────────────────────────
    const mtProtoStatus = getMtProtoStatus();

    // ── Streaming mode ─────────────────────────────────────────────────────────
    // streaming reflects the actual download providers available:
    //   - MTPROTO:         MTProto is connected — supports files of any size.
    //   - STANDARD_BOT_API: using api.telegram.org (20 MB getFile limit)
    //   - LOCAL_BOT_API:   using a Local Bot API Server (up to 2 GB) — but only
    //                      reported as LOCAL_BOT_API when the server is actually
    //                      reachable, not merely configured.
    //   - NOT_AVAILABLE:    no bot token configured.
    let streamingMode: "MTPROTO" | "STANDARD_BOT_API" | "LOCAL_BOT_API" | "NOT_AVAILABLE" = "NOT_AVAILABLE";
    let largeFileStreaming = false;
    if (!telegramApi) {
      streamingMode = "NOT_AVAILABLE";
      largeFileStreaming = false;
    } else if (isLocalBotApiConfigured() && localBotApiStatus === "ok") {
      // Local Bot API Server is healthy — preferred over MTProto because it
      // supports files up to 2 GB AND resolves private channels via numeric ID.
      streamingMode = "LOCAL_BOT_API";
      largeFileStreaming = true;
    } else if (mtProtoStatus.connected) {
      // MTProto is connected — supports files of any size.
      streamingMode = "MTPROTO";
      largeFileStreaming = true;
    } else if (isLocalBotApiConfigured()) {
      // Local server configured but unreachable — falls back to standard Bot API.
      streamingMode = "STANDARD_BOT_API";
      largeFileStreaming = false;
    } else {
      streamingMode = "STANDARD_BOT_API";
      largeFileStreaming = false;
    }

    // ── Active sources count ────────────────────────────────────────────────
    const [activeSources] = await db.select({
      count: sql<number>`count(*)::int`,
    }).from(telegramSourcesTable)
      .where(eq(telegramSourcesTable.enabled, true));

    res.json({
      sources,
      totalVideos: videos.total,
      activeSources: activeSources.count,
      importQueue: queueStats,
      streamQueue: streamQueueStats,
      webhook: webhookInfo,
      botUsername,
      botApiError,
      lastSuccessfulImport: lastImport ? { createdAt: lastImport.createdAt, sourceName: lastImport.sourceName } : null,
      lastFailedImport: lastFailedImport ? { createdAt: lastFailedImport.createdAt, errorMessage: lastFailedImport.errorMessage } : null,
      streamingMode,
      largeFileStreaming,
      components: {
        telegramApi: botApiStatus,
        webhook: webhookStatus,
        database: "ok",
        indexer: telegramApi ? "ok" : "not_configured",
        streaming: streamingMode === "NOT_AVAILABLE" ? "not_configured" : "ok",
        localBotApi: localBotApiStatus,
        mtproto: mtProtoStatus.state === "skipped"
          ? "skipped"
          : mtProtoStatus.connected
            ? "ok"
            : mtProtoStatus.enabled
              ? "error"
              : "not_configured",
      },
      mtproto: {
        enabled: mtProtoStatus.enabled,
        connected: mtProtoStatus.connected,
        authenticated: mtProtoStatus.authenticated,
        sessionManagedAutomatically: mtProtoStatus.sessionManagedAutomatically,
        authType: mtProtoStatus.authType,
        apiIdConfigured: mtProtoStatus.apiIdConfigured,
        state: mtProtoStatus.state,
        error: mtProtoStatus.error,
      },
    });
  } catch (err) {
    logger.error({ err }, "GET /admin/telegram/health failed");
    res.status(500).json({ error: "Health check failed" });
  }
});

// ── POST /api/admin/telegram/test — run actual Telegram checks ────────────────
router.post("/admin/telegram/test", authenticate, requireRole("admin", "owner"), async (_req, res) => {
  try {
    const results: Record<string, { status: "ok" | "error"; detail?: string }> = {};

    // 1. Bot API check (fresh getMe — never cached)
    if (!isTelegramConfigured()) {
      results.botApi = { status: "error", detail: "TELEGRAM_BOT_TOKEN not configured" };
    } else {
      const result = await testBotApi();
      results.botApi = result.ok
        ? { status: "ok", detail: `@${result.username}` }
        : { status: "error", detail: result.error };
    }

    // 2. Webhook check (getWebhookInfo)
    if (!isTelegramConfigured()) {
      results.webhook = { status: "error", detail: "Bot token not configured" };
    } else {
      try {
        const info = await getWebhookInfo();
        results.webhook = {
          status: info.url && !info.lastErrorMessage ? "ok" : "error",
          detail: info.url
            ? `URL: ${info.url}, Pending: ${info.pendingUpdateCount}`
            : "No webhook URL set",
        };
      } catch (err) {
        results.webhook = { status: "error", detail: err instanceof Error ? err.message : "Unknown" };
      }
    }

    // 3. Database check
    try {
      await db.execute(sql`SELECT 1`);
      results.database = { status: "ok" };
    } catch (err) {
      results.database = { status: "error", detail: err instanceof Error ? err.message : "Unknown" };
    }

    // 4. Source check
    try {
      const [row] = await db.select({ count: sql<number>`count(*)::int` })
        .from(telegramSourcesTable);
      results.sources = {
        status: "ok",
        detail: `${row.count} source(s) registered`,
      };
    } catch (err) {
      results.sources = { status: "error", detail: err instanceof Error ? err.message : "Unknown" };
    }

    // 5. Queue processor
    results.indexer = { status: "ok", detail: "Queue processor running" };

    // 6. Streaming — reflects the actual Bot API endpoint and large-file support.
    if (!isTelegramConfigured()) {
      results.streaming = { status: "error", detail: "Bot token not configured" };
    } else if (isLocalBotApiConfigured()) {
      const healthy = await checkLocalBotApiHealth();
      results.streaming = {
        status: healthy ? "ok" : "error",
        detail: healthy
          ? "Local Bot API Server — large file streaming (up to 2 GB) available"
          : "Local Bot API Server configured but unreachable — falling back to standard mode",
      };
    } else {
      results.streaming = {
        status: "ok",
        detail: "Standard Bot API — 20 MB file limit (Telegram-imposed)",
      };
    }

    // 7. Local Bot API Server — real connection test
    if (!isLocalBotApiConfigured()) {
      results.localBotApi = { status: "error", detail: "Not configured" };
    } else {
      const healthy = await checkLocalBotApiHealth();
      results.localBotApi = {
        status: healthy ? "ok" : "error",
        detail: healthy ? "Reachable" : "Configured but unreachable",
      };
    }

    // 8. MTProto — large-file streaming (>20 MB)
    if (!isMtProtoConfigured()) {
      results.mtproto = { status: "error", detail: "Not configured (set TELEGRAM_API_ID + TELEGRAM_API_HASH + TELEGRAM_BOT_TOKEN)" };
    } else if (isLocalBotApiConfigured()) {
      results.mtproto = { status: "ok", detail: "Skipped — Local Bot API Server handles large files (up to 2 GB)" };
    } else if (isMtProtoReady()) {
      results.mtproto = { status: "ok", detail: "Connected — large-file streaming (>20 MB) available" };
    } else {
      const status = getMtProtoStatus();
      results.mtproto = { status: "error", detail: `Configured but ${status.state}${status.error ? `: ${status.error}` : ""}` };
    }

    res.json({ results });
  } catch (err) {
    logger.error({ err }, "POST /admin/telegram/test failed");
    res.status(500).json({ error: "Test failed" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC ENDPOINTS — video catalog & streaming
// ═══════════════════════════════════════════════════════════════════════════

// ── GET /api/telegram-videos — list Telegram videos ─────────────────────────
router.get("/telegram-videos", optionalAuth, async (req, res) => {
  try {
    const {
      search, sourceId,
      page = "1", limit = "20", sort = "telegramDate", order = "desc",
    } = req.query as Record<string, string>;

    const pageNum = parseInt(page) || 1;
    const limitNum = Math.min(parseInt(limit) || 20, 100);
    const offset = (pageNum - 1) * limitNum;

    logger.info(
      { userId: req.user?.userId, role: req.user?.role, page: pageNum, limit: limitNum, search, sourceId },
      "[TELEGRAM_VIDEOS][GET] Request received",
    );

    // Only show COMPLETED (or legacy "active") videos to the public.
    // Non-completed videos (queued, uploading, processing, failed, etc.)
    // are NOT accessible to users — only to admins.
    const filterConditions: any[] = [
      eq(telegramSourcesTable.enabled, true),
      inArray(telegramVideosTable.status, [...TELEGRAM_VIDEO_PUBLIC_STATUSES]),
    ];

    if (search) {
      filterConditions.push(ilike(telegramVideosTable.title, `%${search}%`));
    }
    if (sourceId) {
      filterConditions.push(eq(telegramVideosTable.telegramSourceId, sourceId));
    }

    const sortColMap: Record<string, any> = {
      telegramDate: telegramVideosTable.telegramDate,
      indexedAt: telegramVideosTable.indexedAt,
      title: telegramVideosTable.title,
      fileSize: telegramVideosTable.fileSize,
    };
    const sortCol = sortColMap[sort] ?? telegramVideosTable.telegramDate;
    const { asc, desc: descFn } = await import("drizzle-orm");
    const orderFn = order === "asc" ? asc : descFn;

    const rows = await db.select({
      video: telegramVideosTable,
      sourceName: telegramSourcesTable.name,
    }).from(telegramVideosTable)
      .innerJoin(telegramSourcesTable,
        eq(telegramVideosTable.telegramSourceId, telegramSourcesTable.id))
      .where(and(...filterConditions))
      .orderBy(orderFn(sortCol))
      .limit(limitNum).offset(offset);

    const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
      .from(telegramVideosTable)
      .innerJoin(telegramSourcesTable,
        eq(telegramVideosTable.telegramSourceId, telegramSourcesTable.id))
      .where(and(...filterConditions));

    const data = rows.map((r: any) => ({
      ...r.video,
      sourceName: r.sourceName,
      telegramFileId: undefined,
      thumbnailFileId: undefined,
      hasThumbnail: Boolean(r.video.thumbnailUrl || r.video.thumbnailFileId),
    }));

    logger.info(
      { resultCount: data.length, total: Number(total) },
      "[TELEGRAM_VIDEOS][DB] Query success",
    );

    res.json({ data, total: Number(total), page: pageNum, limit: limitNum });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined },
      "[TELEGRAM_VIDEOS][GET][ERROR] Failed to fetch Telegram videos",
    );
    res.status(500).json({ error: "Failed to fetch Telegram videos" });
  }
});

// ── GET /api/telegram-videos/sources — list enabled sources (for filter) ────
router.get("/telegram-videos/sources", optionalAuth, async (_req, res) => {
  try {
    const sources = await db.select({
      id: telegramSourcesTable.id,
      name: telegramSourcesTable.name,
      type: telegramSourcesTable.type,
      videoCount: telegramSourcesTable.videoCount,
    }).from(telegramSourcesTable)
      .where(eq(telegramSourcesTable.enabled, true))
      .orderBy(telegramSourcesTable.name);

    logger.info({ sourceCount: sources.length }, "[TELEGRAM_SOURCE][GET] Sources fetched");
    res.json(sources);
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "[TELEGRAM_SOURCE][GET][ERROR] Failed to fetch video sources",
    );
    res.status(500).json({ error: "Failed to fetch video sources" });
  }
});

// ── GET /api/telegram-videos/:id — get a single video ───────────────────────
router.get("/telegram-videos/:id", optionalAuth, async (req, res) => {
  try {
    const [row] = await db.select({
      video: telegramVideosTable,
      sourceName: telegramSourcesTable.name,
    }).from(telegramVideosTable)
      .innerJoin(telegramSourcesTable,
        eq(telegramVideosTable.telegramSourceId, telegramSourcesTable.id))
      .where(eq(telegramVideosTable.id, req.params.id as string))
      .limit(1);

    if (!row) { res.status(404).json({ error: "Not found" }); return; }

    // Block non-completed videos from public access.
    // Admins can see all statuses; non-admins get 404.
    const isStaff = req.user && ["admin", "owner"].includes(req.user.role);
    if (!isStaff && !TELEGRAM_VIDEO_PUBLIC_STATUSES.includes(row.video.status as any)) {
      res.status(404).json({ error: "Not found" }); return;
    }

    const hasAccess = await checkTelegramVideoAccess(req.user?.userId, row.video);

    res.json({
      ...row.video,
      sourceName: row.sourceName,
      telegramFileId: undefined,
      thumbnailFileId: undefined,
      hasThumbnail: Boolean(row.video.thumbnailUrl || row.video.thumbnailFileId),
      hasAccess,
    });
  } catch (err) {
    logger.error({ err }, "GET /telegram-videos/:id failed");
    res.status(500).json({ error: "Failed to get video" });
  }
});

// Serve the original Telegram thumbnail when persistent media storage has not
// produced a public thumbnail URL. Telegram file IDs and the bot token stay on
// the server; clients request this endpoint by video ID only.
router.get("/telegram-videos/:id/thumbnail", optionalAuth, async (req, res) => {
  const videoId = req.params.id as string;
  try {
    const [row] = await db.select({
      video: telegramVideosTable,
    }).from(telegramVideosTable)
      .innerJoin(telegramSourcesTable,
        eq(telegramVideosTable.telegramSourceId, telegramSourcesTable.id))
      .where(and(
        eq(telegramVideosTable.id, videoId),
        eq(telegramSourcesTable.enabled, true),
      ))
      .limit(1);

    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    const isStaff = req.user && ["admin", "owner"].includes(req.user.role);
    if (!isStaff && !TELEGRAM_VIDEO_PUBLIC_STATUSES.includes(row.video.status as any)) {
      res.status(404).json({ error: "Not found" }); return;
    }
    if (!(await checkTelegramVideoAccess(req.user?.userId, row.video))) {
      res.status(403).json({ error: "Access denied" }); return;
    }
    if (!row.video.thumbnailFileId) {
      res.status(404).json({ error: "Thumbnail not available" }); return;
    }

    const fileInfo = await getFileInfo(row.video.thumbnailFileId);
    const imageResponse = await fetch(getFileUrl(fileInfo.filePath));
    if (!imageResponse.ok) {
      logger.warn(
        { videoId, status: imageResponse.status },
        "[TELEGRAM THUMBNAIL] Telegram file download failed",
      );
      res.status(502).json({ error: "Telegram thumbnail unavailable" }); return;
    }

    const image = Buffer.from(await imageResponse.arrayBuffer());
    if (image.length === 0 || image.length > 2 * 1024 * 1024) {
      res.status(502).json({ error: "Invalid Telegram thumbnail" }); return;
    }
    const declaredType = imageResponse.headers.get("content-type")?.split(";")[0].toLowerCase();
    const detectedType =
      image.length >= 3 && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff ? "image/jpeg"
        : image.subarray(0, 8).toString("hex") === "89504e470d0a1a0a" ? "image/png"
          : image.subarray(0, 4).toString("ascii") === "GIF8" ? "image/gif"
            : image.subarray(0, 4).toString("ascii") === "RIFF" &&
              image.subarray(8, 12).toString("ascii") === "WEBP" ? "image/webp"
              : null;
    const contentType = detectedType ?? (declaredType?.startsWith("image/") ? declaredType : null);
    if (!contentType) {
      logger.warn(
        { videoId, declaredType },
        "[TELEGRAM THUMBNAIL] Telegram returned an unrecognized image",
      );
      res.status(502).json({ error: "Telegram thumbnail unavailable" }); return;
    }
    res
      .status(200)
      .setHeader("Content-Type", contentType)
      .setHeader("Content-Length", String(image.length))
      .setHeader("Cache-Control", "private, max-age=300")
      .send(image);
  } catch (err) {
    // Avoid logging Bot API URLs, which contain the bot token.
    const errorCode = typeof (err as { errorCode?: unknown })?.errorCode === "number"
      ? (err as { errorCode: number }).errorCode
      : undefined;
    logger.warn({ videoId, errorCode }, "[TELEGRAM THUMBNAIL] Telegram thumbnail fetch failed");
    if (!res.headersSent) res.status(502).json({ error: "Telegram thumbnail unavailable" });
  }
});

// ── POST /api/telegram-videos/:id/stream-ticket — issue a playback ticket ──
// The native HTML5 <video> element cannot attach an Authorization header to
// its src request, so the frontend first asks for this signed
// ticket (after full authentication + premium access checks) and then plays
// GET .../stream?ticket=<ticket>. The ticket contains ONLY videoId + userId,
// with no expiry so later Range requests remain valid — never the bot token
// or a Telegram file_id.
router.post("/telegram-videos/:id/stream-ticket", authenticate, async (req, res) => {
  try {
    const [row] = await db.select({
      video: telegramVideosTable,
    }).from(telegramVideosTable)
      .innerJoin(telegramSourcesTable,
        eq(telegramVideosTable.telegramSourceId, telegramSourcesTable.id))
      .where(and(
        eq(telegramVideosTable.id, req.params.id as string),
        eq(telegramSourcesTable.enabled, true),
      ))
      .limit(1);

    if (!row) { res.status(404).json({ error: "Not found" }); return; }

    // Block non-completed videos — no stream ticket for unprocessed videos.
    if (!TELEGRAM_VIDEO_PUBLIC_STATUSES.includes(row.video.status as any)) {
      res.status(404).json({ error: "Not found" }); return;
    }

    const hasAccess = await checkTelegramVideoAccess(req.user!.userId, row.video);
    if (!hasAccess) {
      res.status(403).json({ error: "Access denied — premium subscription required" }); return;
    }

    const { ticket, expiresIn } = createStreamTicket(row.video.id, req.user!.userId);
    res.json({
      ticket,
      streamUrl: `/api/telegram-videos/${row.video.id}/stream?ticket=${encodeURIComponent(ticket)}`,
      expiresIn,
    });
  } catch (err) {
    logger.error({ err }, "POST /telegram-videos/:id/stream-ticket failed");
    res.status(500).json({ error: "Failed to create stream ticket" });
  }
});

// ── GET /api/telegram-videos/:id/stream — stream video (Range support) ──────
// Auth: Bearer header (normal API clients) OR ?ticket= playback ticket —
// never public. See streamAuth above.
router.head("/telegram-videos/:id/stream", streamAuth, async (req, res) => {
  try {
    const [row] = await db.select({
      video: telegramVideosTable,
    }).from(telegramVideosTable)
      .innerJoin(telegramSourcesTable,
        eq(telegramVideosTable.telegramSourceId, telegramSourcesTable.id))
      .where(and(
        eq(telegramVideosTable.id, req.params.id as string),
        eq(telegramSourcesTable.enabled, true),
      ))
      .limit(1);

    if (!row) { res.status(404).end(); return; }

    const isStaff = req.user && ["admin", "owner"].includes(req.user.role);
    if (!isStaff && !TELEGRAM_VIDEO_PUBLIC_STATUSES.includes(row.video.status as any)) {
      res.status(404).end();
      return;
    }
    if (!(await checkTelegramVideoAccess(req.user!.userId, row.video))) {
      res.status(403).end();
      return;
    }
    if (row.video.status === "error" || row.video.status === "unavailable") {
      res.status(503).end();
      return;
    }
    if (!row.video.telegramFileId && !isMtProtoReady()) {
      res.status(404).end();
      return;
    }

    res.setHeader("Content-Type", getVideoContentType(row.video.mimeType));
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, no-store");
    const fileSize = row.video.fileSize;
    if (typeof fileSize === "number" && Number.isSafeInteger(fileSize) && fileSize >= 0) {
      res.setHeader("Content-Length", String(fileSize));
    }
    res.status(200).end();
  } catch (err) {
    logger.error({ err, videoId: req.params.id }, "[TELEGRAM STREAM] HEAD failed");
    res.status(500).end();
  }
});

router.get("/telegram-videos/:id/stream", streamAuth, async (req, res) => {
  try {
    const rangeHeader = req.headers.range;
    logger.info(
      { videoId: req.params.id, authMode: req.headers.authorization ? "bearer" : "ticket", hasRange: !!rangeHeader },
      "[TELEGRAM STREAM] request",
    );
    if (rangeHeader) {
      logger.info({ videoId: req.params.id, range: rangeHeader }, "[TELEGRAM STREAM] range request");
    }

    const [row] = await db.select({
      video: telegramVideosTable,
    }).from(telegramVideosTable)
      .innerJoin(telegramSourcesTable,
        eq(telegramVideosTable.telegramSourceId, telegramSourcesTable.id))
      .where(and(
        eq(telegramVideosTable.id, req.params.id as string),
        eq(telegramSourcesTable.enabled, true),
      ))
      .limit(1);

    if (!row) { res.status(404).json({ error: "Not found" }); return; }

    // Block non-completed videos — no streaming for unprocessed videos.
    // Admins can still stream for debugging/monitoring.
    const isStaff = req.user && ["admin", "owner"].includes(req.user.role);
    if (!isStaff && !TELEGRAM_VIDEO_PUBLIC_STATUSES.includes(row.video.status as any)) {
      res.status(404).json({ error: "Not found" }); return;
    }

    const hasAccess = await checkTelegramVideoAccess(req.user!.userId, row.video);
    if (!hasAccess) {
      res.status(403).json({ error: "Access denied — premium subscription required" }); return;
    }

    // AutoUP-imported videos have telegramFileId = null (they use MTProto
    // with chatId + messageId, not a Bot API file_id). Allow streaming when
    // MTProto is available; only block when BOTH fileId is missing AND
    // MTProto is not ready (Bot API requires a file_id).
    if (!row.video.telegramFileId && !isMtProtoReady()) {
      res.status(404).json({
        error: "Video file_id not available",
        detail: "Video ini tidak memiliki file_id Telegram dan MTProto tidak tersedia. Set TELEGRAM_API_ID dan TELEGRAM_API_HASH untuk mengaktifkan streaming video tanpa file_id.",
      }); return;
    }

    // Check video status — error/unavailable videos should not be streamed.
    if (row.video.status === "error" || row.video.status === "unavailable") {
      res.status(503).json({ error: "Video sedang tidak tersedia", detail: row.video.status }); return;
    }

    // Capture narrowed values — closures lose TypeScript's null-narrowing.
    const fileId = row.video.telegramFileId;
    const videoId = row.video.id;
    const chatId = row.video.telegramChatId;
    const messageId = row.video.telegramMessageId;

    await enqueueStream(() => streamTelegramVideo({
      fileId,
      videoId,
      chatId,
      messageId,
      mimeType: row.video.mimeType || "application/octet-stream",
      res,
      rangeHeader: req.headers.range,
      fileSize: row.video.fileSize ?? null,
    }));
    logger.info({ videoId: req.params.id }, "[TELEGRAM STREAM] completed");
  } catch (err) {
    logger.error({ err, videoId: req.params.id }, "[TELEGRAM STREAM] failed");
    if (!res.headersSent) {
      res.status(500).json({ error: "Streaming failed" });
    }
  }
});

export default router;
