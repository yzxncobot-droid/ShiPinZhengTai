/**
 * AutoUP — API routes for owner/admin.
 *
 * CRUD for AutoUP configs + processing logs. All endpoints require
 * admin/owner role (enforced server-side via requireRole).
 *
 * Telegram credentials are never sent to the frontend.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import {
  autoupConfigsTable, autoupProcessingLogsTable,
  telegramSourcesTable,
} from "@workspace/db";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { authenticate, requireRole } from "../middlewares/auth";
import { logger } from "../lib/logger";
import { getAutoUpStats } from "../lib/telegram/autoup";

const router = Router();

// All routes require authentication + admin/owner role.
router.use(authenticate, requireRole("admin", "owner"));

// ── GET /admin/autoup — list configs + stats ────────────────────────────────

router.get("/admin/autoup", async (_req, res) => {
  try {
    logger.info({ userId: _req.user?.userId }, "[AUTOUP][GET] Fetching configs + stats");

    const configs = await db.select({
      config: autoupConfigsTable,
      source: telegramSourcesTable,
    })
      .from(autoupConfigsTable)
      .leftJoin(telegramSourcesTable,
        eq(autoupConfigsTable.telegramSourceId, telegramSourcesTable.id))
      .orderBy(desc(autoupConfigsTable.createdAt));

    const stats = await getAutoUpStats();

    logger.info({ configCount: configs.length }, "[AUTOUP][GET] Success");

    res.json({
      configs: configs.map((row) => ({
        ...row.config,
        source: row.source ? {
          id: row.source.id,
          name: row.source.name,
          chatId: row.source.chatId,
          type: row.source.type,
          status: row.source.status,
          enabled: row.source.enabled,
        } : null,
      })),
      stats,
    });
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined }, "[AUTOUP][GET][ERROR] Failed to fetch configs");
    res.status(500).json({ error: "Gagal memuat data AutoUP", detail: err instanceof Error ? err.message : String(err) });
  }
});

// ── POST /admin/autoup — create config ──────────────────────────────────────

router.post("/admin/autoup", async (req, res) => {
  try {
    const { name, telegramSourceId, isPremium, price, description, enabled } = req.body;

    logger.info({ userId: req.user?.userId, name, telegramSourceId, isPremium }, "[AUTOUP][CREATE] Request received");

    if (!name?.trim()) {
      res.status(400).json({ error: "Nama AutoUP wajib diisi" });
      return;
    }
    if (!telegramSourceId) {
      res.status(400).json({ error: "Sumber Telegram wajib dipilih" });
      return;
    }

    // Verify the source exists and is enabled.
    const [source] = await db.select().from(telegramSourcesTable)
      .where(eq(telegramSourcesTable.id, telegramSourceId)).limit(1);

    if (!source) {
      res.status(400).json({ error: "Sumber Telegram tidak ditemukan" });
      return;
    }

    const isPremiumBool = !!isPremium;

    // Price validation for premium configs.
    if (isPremiumBool) {
      const priceNum = Number(price);
      if (!priceNum || isNaN(priceNum)) {
        res.status(400).json({ error: "Nominal wajib diisi untuk Premium" });
        return;
      }
      if (!Number.isInteger(priceNum)) {
        res.status(400).json({ error: "Nominal harus berupa angka bulat" });
        return;
      }
      if (priceNum < 100) {
        res.status(400).json({ error: "Minimum nominal Rp100" });
        return;
      }
    }

    const safePrice = isPremiumBool ? Number(price) : null;

    const [config] = await db.insert(autoupConfigsTable).values({
      name: name.trim(),
      telegramSourceId,
      isPremium: isPremiumBool,
      price: safePrice,
      description: description?.trim() || null,
      enabled: enabled !== false,
      createdBy: req.user!.userId,
    }).returning();

    logger.info({ configId: config.id, userId: req.user!.userId, name: config.name, isPremium: config.isPremium, price: config.price }, "[AUTOUP][CREATE] Config created successfully");

    res.status(201).json(config);
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined }, "[AUTOUP][CREATE][ERROR] Failed to create config");
    res.status(500).json({ error: "Gagal membuat AutoUP", detail: err instanceof Error ? err.message : String(err) });
  }
});

// ── PATCH /admin/autoup/:id — update config ─────────────────────────────────

router.patch("/admin/autoup/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, telegramSourceId, isPremium, price, description, enabled } = req.body;

    const [existing] = await db.select().from(autoupConfigsTable)
      .where(eq(autoupConfigsTable.id, id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "AutoUP tidak ditemukan" });
      return;
    }

    const updates: Record<string, any> = { updatedAt: new Date() };

    if (name !== undefined) {
      if (!name?.trim()) { res.status(400).json({ error: "Nama tidak boleh kosong" }); return; }
      updates.name = name.trim();
    }
    if (telegramSourceId !== undefined) {
      const [source] = await db.select().from(telegramSourcesTable)
        .where(eq(telegramSourcesTable.id, telegramSourceId)).limit(1);
      if (!source) { res.status(400).json({ error: "Sumber Telegram tidak ditemukan" }); return; }
      updates.telegramSourceId = telegramSourceId;
    }
    if (isPremium !== undefined) {
      updates.isPremium = !!isPremium;
      if (!isPremium) updates.price = null;
    }
    if (price !== undefined) {
      updates.price = existing.isPremium || isPremium ? Number(price) || 0 : null;
    }
    if (description !== undefined) {
      updates.description = description?.trim() || null;
    }
    if (enabled !== undefined) {
      updates.enabled = !!enabled;
    }

    const [updated] = await db.update(autoupConfigsTable).set(updates)
      .where(eq(autoupConfigsTable.id, id)).returning();

    res.json(updated);
  } catch (err) {
    logger.error({ err }, "[AUTOUP] PATCH /admin/autoup/:id failed");
    res.status(500).json({ error: "Gagal memperbarui AutoUP" });
  }
});

// ── POST /admin/autoup/:id/toggle — enable/disable ──────────────────────────

router.post("/admin/autoup/:id/toggle", async (req, res) => {
  try {
    const { id } = req.params;
    const [existing] = await db.select().from(autoupConfigsTable)
      .where(eq(autoupConfigsTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "AutoUP tidak ditemukan" }); return; }

    const [updated] = await db.update(autoupConfigsTable).set({
      enabled: !existing.enabled,
      updatedAt: new Date(),
    }).where(eq(autoupConfigsTable.id, id)).returning();

    res.json({ enabled: updated.enabled });
  } catch (err) {
    logger.error({ err }, "[AUTOUP] toggle failed");
    res.status(500).json({ error: "Gagal mengubah status AutoUP" });
  }
});

// ── DELETE /admin/autoup/:id — delete config ────────────────────────────────

router.delete("/admin/autoup/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await db.delete(autoupConfigsTable).where(eq(autoupConfigsTable.id, id));
    res.json({ message: "AutoUP berhasil dihapus" });
  } catch (err) {
    logger.error({ err }, "[AUTOUP] delete failed");
    res.status(500).json({ error: "Gagal menghapus AutoUP" });
  }
});

// ── GET /admin/autoup/:id/logs — processing logs ────────────────────────────

router.get("/admin/autoup/:id/logs", async (req, res) => {
  try {
    const { id } = req.params;
    const { status, limit = "50" } = req.query as Record<string, string>;

    const conditions = [eq(autoupProcessingLogsTable.autoupConfigId, id)];
    if (status && status !== "ALL") {
      conditions.push(eq(autoupProcessingLogsTable.status, status as any));
    }

    const limitNum = Math.min(parseInt(limit) || 50, 200);

    const logs = await db.select()
      .from(autoupProcessingLogsTable)
      .where(and(...conditions))
      .orderBy(desc(autoupProcessingLogsTable.createdAt))
      .limit(limitNum);

    res.json(logs);
  } catch (err) {
    logger.error({ err }, "[AUTOUP] GET logs failed");
    res.status(500).json({ error: "Gagal memuat log" });
  }
});

// ── GET /admin/autoup/sources — list available Telegram sources ─────────────

router.get("/admin/autoup/sources", async (_req, res) => {
  try {
    logger.info("[AUTOUP][GET] Fetching telegram sources");

    const sources = await db.select({
      id: telegramSourcesTable.id,
      name: telegramSourcesTable.name,
      chatId: telegramSourcesTable.chatId,
      type: telegramSourcesTable.type,
      status: telegramSourcesTable.status,
      enabled: telegramSourcesTable.enabled,
      videoCount: telegramSourcesTable.videoCount,
    })
      .from(telegramSourcesTable)
      .where(eq(telegramSourcesTable.enabled, true))
      .orderBy(desc(telegramSourcesTable.createdAt));

    logger.info({ sourceCount: sources.length }, "[AUTOUP][GET] Sources fetched");
    res.json(sources);
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "[AUTOUP][GET][ERROR] Failed to fetch sources");
    res.status(500).json({ error: "Gagal memuat sumber Telegram", detail: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
