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
import { Router } from "express";
import { db } from "@workspace/db";
import {
  telegramSourcesTable, telegramVideosTable, telegramSyncLogsTable,
  telegramImportLogsTable, usersTable, userSubscriptionsTable,
} from "@workspace/db";
import { eq, and, desc, ilike, sql, inArray } from "drizzle-orm";
import { authenticate, optionalAuth, requireRole } from "../middlewares/auth";
import { logger } from "../lib/logger";
import {
  isTelegramConfigured, isLocalBotApiConfigured, checkLocalBotApiHealth,
  testConnection, getBotInfo, testBotApi,
  setWebhook, getWebhookInfo, deleteWebhook,
} from "../lib/telegram/client";
import {
  processIncomingUpdate, startQueueProcessor, getQueueStats,
  retryImportLog, syncSource,
} from "../lib/telegram/indexer";
import { streamTelegramVideo } from "../lib/telegram/streamer";

const router = Router();

// Start the import queue processor when the module loads.
startQueueProcessor();

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

  // Process the update asynchronously — return 200 immediately.
  processIncomingUpdate(req.body).catch((err) => {
    logger.error({ err }, "[TELEGRAM] Webhook processing error");
  });

  // Always return 200 quickly so Telegram doesn't retry.
  res.status(200).json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN ENDPOINTS — require admin/owner role
// ═══════════════════════════════════════════════════════════════════════════

// ── GET /api/admin/telegram/sources — list all sources ──────────────────────
router.get("/admin/telegram/sources", authenticate, requireRole("admin", "owner"), async (_req, res) => {
  try {
    const sources = await db.select().from(telegramSourcesTable)
      .orderBy(desc(telegramSourcesTable.createdAt));
    res.json(sources);
  } catch (err) {
    logger.error({ err }, "GET /admin/telegram/sources failed");
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

    // Construct the webhook URL from PUBLIC_BASE_URL (preferred), falling back
    // to the Base44 public host suffix. The admin may also pass an explicit URL.
    const publicUrl = req.body.url ||
      (process.env.PUBLIC_BASE_URL
        ? `${process.env.PUBLIC_BASE_URL}/api/telegram/webhook`
        : process.env.BASE44_PUBLIC_HOST_SUFFIX
          ? `https://3000-${process.env.BASE44_PUBLIC_HOST_SUFFIX}/api/telegram/webhook`
          : null);

    if (!publicUrl) {
      res.status(400).json({
        error: "PUBLIC_BASE_URL not configured. Set the PUBLIC_BASE_URL environment variable (e.g. https://your-domain.com) so the webhook URL can be constructed.",
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
  if (!botApiOk) errors.push(`getMe failed: ${botResult.error}`);

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
  const publicBaseUrl = process.env.PUBLIC_BASE_URL;
  if (publicBaseUrl && webhookUrl) {
    const expectedUrl = `${publicBaseUrl}/api/telegram/webhook`;
    if (webhookUrl !== expectedUrl) {
      errors.push(`Webhook URL mismatch: expected ${expectedUrl}, got ${webhookUrl}`);
      webhookOk = false;
    }
  } else if (!publicBaseUrl) {
    errors.push("PUBLIC_BASE_URL not configured");
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
    publicBaseUrl: publicBaseUrl || null,
    webhookUrl: webhookUrl || null,
    pendingUpdates,
    errors,
  });
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

    // ── Streaming mode ─────────────────────────────────────────────────────────
    // streaming reflects the actual Bot API endpoint in use:
    //   - STANDARD_BOT_API: using api.telegram.org (20 MB getFile limit)
    //   - LOCAL_BOT_API:    using a Local Bot API Server (up to 2 GB) — but only
    //                       reported as LOCAL_BOT_API when the server is actually
    //                       reachable, not merely configured.
    //   - NOT_AVAILABLE:    no bot token configured.
    let streamingMode: "STANDARD_BOT_API" | "LOCAL_BOT_API" | "NOT_AVAILABLE" = "NOT_AVAILABLE";
    let largeFileStreaming = false;
    if (!telegramApi) {
      streamingMode = "NOT_AVAILABLE";
      largeFileStreaming = false;
    } else if (isLocalBotApiConfigured()) {
      // Only claim large-file support if the server is actually reachable.
      if (localBotApiStatus === "ok") {
        streamingMode = "LOCAL_BOT_API";
        largeFileStreaming = true;
      } else {
        // Configured but unreachable — fall back to standard mode, no large file.
        streamingMode = "STANDARD_BOT_API";
        largeFileStreaming = false;
      }
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

    const filterConditions: any[] = [eq(telegramSourcesTable.enabled, true)];

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
    }));

    res.json({ data, total: Number(total), page: pageNum, limit: limitNum });
  } catch (err) {
    logger.error({ err }, "GET /telegram-videos failed");
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

    res.json(sources);
  } catch (err) {
    logger.error({ err }, "GET /telegram-videos/sources failed");
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

    const hasAccess = await checkTelegramVideoAccess(req.user?.userId, row.video);

    res.json({
      ...row.video,
      sourceName: row.sourceName,
      telegramFileId: undefined,
      hasAccess,
    });
  } catch (err) {
    logger.error({ err }, "GET /telegram-videos/:id failed");
    res.status(500).json({ error: "Failed to get video" });
  }
});

// ── GET /api/telegram-videos/:id/stream — stream video (Range support) ──────
router.get("/telegram-videos/:id/stream", authenticate, async (req, res) => {
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

    const hasAccess = await checkTelegramVideoAccess(req.user?.userId, row.video);
    if (!hasAccess) {
      res.status(403).json({ error: "Access denied — premium subscription required" }); return;
    }

    if (!row.video.telegramFileId) {
      res.status(404).json({ error: "Video file_id not available" }); return;
    }

    // Check video status — error/unavailable videos should not be streamed.
    if (row.video.status === "error" || row.video.status === "unavailable") {
      res.status(503).json({ error: "Video sedang tidak tersedia", detail: row.video.status }); return;
    }

    await streamTelegramVideo({
      fileId: row.video.telegramFileId,
      videoId: row.video.id,
      chatId: row.video.telegramChatId,
      messageId: row.video.telegramMessageId,
      mimeType: row.video.mimeType || "video/mp4",
      res,
      rangeHeader: req.headers.range,
    });
  } catch (err) {
    logger.error({ err }, "GET /telegram-videos/:id/stream failed");
    if (!res.headersSent) {
      res.status(500).json({ error: "Streaming failed" });
    }
  }
});

export default router;
