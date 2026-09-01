/**
 * Telegram Video Storage & Streaming — API routes.
 *
 * All endpoints are namespaced to avoid conflicts with existing routes:
 *   Admin:  /api/admin/telegram/...
 *   Public: /api/telegram-videos/...
 *
 * No existing route is modified or replaced.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import {
  telegramSourcesTable, telegramVideosTable, telegramSyncLogsTable,
  usersTable, userSubscriptionsTable,
} from "@workspace/db";
import { eq, and, desc, ilike, sql, isNull } from "drizzle-orm";
import { authenticate, optionalAuth, requireRole } from "../middlewares/auth";
import { logger } from "../lib/logger";
import { isTelegramConfigured, testConnection } from "../lib/telegram/client";
import { syncSource, isSyncing, startAutoSync } from "../lib/telegram/indexer";
import { streamTelegramVideo } from "../lib/telegram/streamer";

const router = Router();

// Start automatic sync when the module loads (no-op if credentials absent).
startAutoSync();

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

  // Admin/owner always have access.
  const [user] = await db.select({ role: usersTable.role })
    .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) return false;
  if (user.role === "admin" || user.role === "owner") return true;

  // Check active subscription (reuses existing subscription system).
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

    // Check for duplicate chat ID.
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

    // Optionally test connection immediately.
    if (isTelegramConfigured()) {
      testConnection(chatId.trim()).then(async (result) => {
        await db.update(telegramSourcesTable).set({
          status: result.success ? "CONNECTED" : "ERROR",
          lastConnectionCheck: new Date(),
          errorMessage: result.success ? null : result.errorMessage,
          type: result.success && result.type ? (result.type as "GROUP" | "CHANNEL") : source.type,
          updatedAt: new Date(),
        }).where(eq(telegramSourcesTable.id, source.id));
      }).catch(() => { /* non-fatal */ });
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
      .where(eq(telegramSourcesTable.id, req.params.id)).limit(1);
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
      .where(eq(telegramSourcesTable.id, req.params.id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Source not found" }); return; }

    const updates: Record<string, any> = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name.trim();
    if (chatId !== undefined) updates.chatId = chatId.trim();
    if (type !== undefined) updates.type = type;
    if (description !== undefined) updates.description = description?.trim() || null;
    if (enabled !== undefined) updates.enabled = enabled;

    const [updated] = await db.update(telegramSourcesTable).set(updates)
      .where(eq(telegramSourcesTable.id, req.params.id)).returning();

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
      .where(eq(telegramSourcesTable.id, req.params.id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Source not found" }); return; }

    // Cascading delete removes all associated videos and sync logs.
    await db.delete(telegramSourcesTable)
      .where(eq(telegramSourcesTable.id, req.params.id));

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
      .where(eq(telegramSourcesTable.id, req.params.id)).limit(1);
    if (!source) { res.status(404).json({ error: "Source not found" }); return; }

    if (!isTelegramConfigured()) {
      res.json({
        success: false,
        errorMessage: "Telegram credentials not configured. Set TELEGRAM_BOT_TOKEN, TELEGRAM_API_ID, TELEGRAM_API_HASH.",
      });
      return;
    }

    const result = await testConnection(source.chatId);

    // Update source status.
    await db.update(telegramSourcesTable).set({
      status: result.success ? "CONNECTED" : "ERROR",
      lastConnectionCheck: new Date(),
      errorMessage: result.success ? null : result.errorMessage,
      ...(result.success && result.type
        ? { type: result.type as "GROUP" | "CHANNEL" }
        : {}),
      updatedAt: new Date(),
    }).where(eq(telegramSourcesTable.id, source.id));

    res.json(result);
  } catch (err) {
    logger.error({ err }, "POST /admin/telegram/sources/:id/test failed");
    res.status(500).json({ error: "Connection test failed" });
  }
});

// ── POST /api/admin/telegram/sources/:id/sync — manual sync ──────────────────
router.post("/admin/telegram/sources/:id/sync", authenticate, requireRole("admin", "owner"), async (req, res) => {
  try {
    const [source] = await db.select().from(telegramSourcesTable)
      .where(eq(telegramSourcesTable.id, req.params.id)).limit(1);
    if (!source) { res.status(404).json({ error: "Source not found" }); return; }

    if (!isTelegramConfigured()) {
      res.status(503).json({ error: "Telegram credentials not configured" }); return;
    }

    if (isSyncing(source.id)) {
      res.status(409).json({ error: "Sync already in progress" }); return;
    }

    // Determine sync type.
    const syncType = source.lastSyncedMessageId ? "incremental" : "initial";

    // For small channels, respond with results immediately.
    // For large channels, the sync may take a while — respond 202 and let it
    // run in the background.
    if (req.query.wait === "true") {
      try {
        const result = await syncSource(source.id, syncType as any);
        res.json({
          message: "Sync completed",
          syncType,
          ...result,
        });
      } catch (err) {
        res.status(500).json({
          error: "Sync failed",
          message: err instanceof Error ? err.message : "Unknown error",
        });
      }
    } else {
      // Run in background, respond immediately.
      syncSource(source.id, syncType as any).catch((err) => {
        logger.error({ err, sourceId: source.id }, "[TELEGRAM] Background sync failed");
      });
      res.status(202).json({
        message: "Sync started",
        syncType,
      });
    }
  } catch (err) {
    logger.error({ err }, "POST /admin/telegram/sources/:id/sync failed");
    res.status(500).json({ error: "Failed to start sync" });
  }
});

// ── GET /api/admin/telegram/sources/:id/logs — sync logs ────────────────────
router.get("/admin/telegram/sources/:id/logs", authenticate, requireRole("admin", "owner"), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const logs = await db.select().from(telegramSyncLogsTable)
      .where(eq(telegramSyncLogsTable.telegramSourceId, req.params.id))
      .orderBy(desc(telegramSyncLogsTable.startedAt))
      .limit(limit);
    res.json(logs);
  } catch (err) {
    logger.error({ err }, "GET /admin/telegram/sources/:id/logs failed");
    res.status(500).json({ error: "Failed to get logs" });
  }
});

// ── GET /api/admin/telegram/health — health check ──────────────────────────
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

    // Determine component health.
    const telegramApi = isTelegramConfigured();
    const database = true; // if we got here, DB is working
    const indexer = telegramApi;
    // Streaming engine is healthy if Telegram is configured
    const streaming = telegramApi;

    res.json({
      sources: sources,
      totalVideos: videos.total,
      components: {
        telegramApi: telegramApi ? "ok" : "not_configured",
        database: database ? "ok" : "error",
        indexer: indexer ? "ok" : "not_configured",
        streaming: streaming ? "ok" : "not_configured",
      },
    });
  } catch (err) {
    logger.error({ err }, "GET /admin/telegram/health failed");
    res.status(500).json({ error: "Health check failed" });
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
      .where(eq(telegramVideosTable.id, req.params.id)).returning();

    if (!updated) { res.status(404).json({ error: "Video not found" }); return; }
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "PATCH /admin/telegram/videos/:id failed");
    res.status(500).json({ error: "Failed to update video" });
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

    const conditions: any[] = [];

    // Only show videos from enabled sources.
    conditions.push(
      eq(telegramVideosTable.telegramSourceId,
        sql`(SELECT id FROM telegram_sources WHERE enabled = true AND deleted_at IS NULL OR id = ${telegramVideosTable.telegramSourceId})`,
      ),
    );

    // Simpler: join to enabled sources via a subquery.
    // Actually, let's just filter directly.
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    // Build query with source info.
    let query = db.select({
      video: telegramVideosTable,
      sourceName: telegramSourcesTable.name,
    }).from(telegramVideosTable)
      .innerJoin(telegramSourcesTable,
        eq(telegramVideosTable.telegramSourceId, telegramSourcesTable.id))
      .where(eq(telegramSourcesTable.enabled, true));

    // Apply additional filters.
    const filterConditions: any[] = [eq(telegramSourcesTable.enabled, true)];

    if (search) {
      filterConditions.push(ilike(telegramVideosTable.title, `%${search}%`));
    }
    if (sourceId) {
      filterConditions.push(eq(telegramVideosTable.telegramSourceId, sourceId));
    }

    // Rebuild with all conditions.
    query = db.select({
      video: telegramVideosTable,
      sourceName: telegramSourcesTable.name,
    }).from(telegramVideosTable)
      .innerJoin(telegramSourcesTable,
        eq(telegramVideosTable.telegramSourceId, telegramSourcesTable.id))
      .where(and(...filterConditions));

    // Sorting.
    const sortColMap: Record<string, any> = {
      telegramDate: telegramVideosTable.telegramDate,
      indexedAt: telegramVideosTable.indexedAt,
      title: telegramVideosTable.title,
      fileSize: telegramVideosTable.fileSize,
    };
    const sortCol = sortColMap[sort] ?? telegramVideosTable.telegramDate;
    const orderFn = order === "asc" ? (await import("drizzle-orm")).asc : (await import("drizzle-orm")).desc;

    const rows = await query.orderBy(orderFn(sortCol)).limit(limitNum).offset(offset);

    // Count total.
    const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
      .from(telegramVideosTable)
      .innerJoin(telegramSourcesTable,
        eq(telegramVideosTable.telegramSourceId, telegramSourcesTable.id))
      .where(and(...filterConditions));

    // Format response — never expose telegram_file_id.
    const data = rows.map((r: any) => ({
      ...r.video,
      sourceName: r.sourceName,
      telegramFileId: undefined,
    }));

    res.json({ data, total: Number(total), page: pageNum, limit: limitNum });
  } catch (err) {
    logger.error({ err }, "GET /telegram-videos failed");
    res.json({ data: [], total: 0, page: 1, limit: 20 });
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
    res.json([]);
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
      .where(eq(telegramVideosTable.id, req.params.id))
      .limit(1);

    if (!row) { res.status(404).json({ error: "Not found" }); return; }

    const hasAccess = await checkTelegramVideoAccess(req.user?.userId, row.video);

    // Never expose telegram_file_id to the frontend.
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
        eq(telegramVideosTable.id, req.params.id),
        eq(telegramSourcesTable.enabled, true),
      ))
      .limit(1);

    if (!row) { res.status(404).json({ error: "Not found" }); return; }

    // Access control — do not bypass premium system.
    const hasAccess = await checkTelegramVideoAccess(req.user?.userId, row.video);
    if (!hasAccess) {
      res.status(403).json({ error: "Access denied — premium subscription required" }); return;
    }

    await streamTelegramVideo({
      chatId: row.video.telegramChatId,
      messageId: row.video.telegramMessageId,
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
