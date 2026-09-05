/**
 * Admin gamification management — achievements, badges, level config,
 * EXP adjustments, and badge assignment.
 *
 * All mutations require admin/owner. Every manual EXP adjustment is logged
 * to exp_audit_logs with admin_id, user_id, amount, and reason.
 */

import { Router } from "express";
import { db } from "@workspace/db";
import {
  achievementsTable, specialBadgesTable, userSpecialBadgesTable,
  levelRewardsTable, expAuditLogsTable, gamificationConfigTable,
  levelBadgeTiersTable, userLevelsTable, expTransactionsTable,
  userAchievementsTable,
} from "@workspace/db";
import { eq, and, desc, asc } from "drizzle-orm";
import { authenticate, requireRole } from "../middlewares/auth";
import {
  awardExp, clearConfigCache, clearTierCache, ensureUserLevel,
} from "../lib/gamification";
import { logger } from "../lib/logger";

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════
// ACHIEVEMENT MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

// ── GET /admin/gamification/achievements ─────────────────────────────────────
router.get("/admin/gamification/achievements", authenticate, requireRole("admin", "owner"), async (req, res) => {
  try {
    const achievements = await db.select().from(achievementsTable)
      .orderBy(desc(achievementsTable.createdAt));
    res.json(achievements);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /admin/gamification/achievements ────────────────────────────────────
router.post("/admin/gamification/achievements", authenticate, requireRole("admin", "owner"), async (req, res) => {
  try {
    const { name, description, icon, rarity, requirementType, requirementValue, expReward, badgeReward, isHidden, isActive } = req.body;
    if (!name || !description || !requirementType) {
      res.status(400).json({ error: "name, description, requirementType are required" });
      return;
    }
    const [created] = await db.insert(achievementsTable).values({
      name, description, icon: icon ?? "🏆",
      rarity: rarity ?? "COMMON",
      requirementType, requirementValue: Number(requirementValue) || 1,
      expReward: Number(expReward) || 0,
      badgeReward: badgeReward ?? null,
      isHidden: Boolean(isHidden),
      isActive: isActive !== false,
    }).returning();
    res.status(201).json(created);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /admin/gamification/achievements/:id ─────────────────────────────────
router.put("/admin/gamification/achievements/:id", authenticate, requireRole("admin", "owner"), async (req, res) => {
  try {
    const { name, description, icon, rarity, requirementType, requirementValue, expReward, badgeReward, isHidden, isActive } = req.body;
    const [updated] = await db.update(achievementsTable).set({
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(icon !== undefined ? { icon } : {}),
      ...(rarity !== undefined ? { rarity } : {}),
      ...(requirementType !== undefined ? { requirementType } : {}),
      ...(requirementValue !== undefined ? { requirementValue: Number(requirementValue) } : {}),
      ...(expReward !== undefined ? { expReward: Number(expReward) } : {}),
      ...(badgeReward !== undefined ? { badgeReward } : {}),
      ...(isHidden !== undefined ? { isHidden: Boolean(isHidden) } : {}),
      ...(isActive !== undefined ? { isActive: Boolean(isActive) } : {}),
      updatedAt: new Date(),
    }).where(eq(achievementsTable.id, req.params.id as string)).returning();
    if (!updated) { res.status(404).json({ error: "Achievement not found" }); return; }
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /admin/gamification/achievements/:id ──────────────────────────────
router.delete("/admin/gamification/achievements/:id", authenticate, requireRole("admin", "owner"), async (req, res) => {
  try {
    // Deactivate instead of hard delete to preserve user_achievements records
    await db.update(achievementsTable).set({ isActive: false, updatedAt: new Date() })
      .where(eq(achievementsTable.id, req.params.id as string));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// SPECIAL BADGE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

// ── GET /admin/gamification/badges ───────────────────────────────────────────
router.get("/admin/gamification/badges", authenticate, requireRole("admin", "owner"), async (req, res) => {
  try {
    const badges = await db.select().from(specialBadgesTable).orderBy(desc(specialBadgesTable.createdAt));
    res.json(badges);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /admin/gamification/badges ───────────────────────────────────────────
router.post("/admin/gamification/badges", authenticate, requireRole("admin", "owner"), async (req, res) => {
  try {
    const { name, icon, color, description, isActive } = req.body;
    if (!name) { res.status(400).json({ error: "name is required" }); return; }
    const [created] = await db.insert(specialBadgesTable).values({
      name: name.toLowerCase().trim(),
      icon: icon ?? "⭐", color: color ?? "#8b5cf6",
      description: description ?? null,
      isActive: isActive !== false,
    }).returning();
    res.status(201).json(created);
  } catch (err: any) {
    if (err?.code === "23505") { res.status(409).json({ error: "Badge name already exists" }); return; }
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /admin/gamification/badges/:id ────────────────────────────────────────
router.put("/admin/gamification/badges/:id", authenticate, requireRole("admin", "owner"), async (req, res) => {
  try {
    const { name, icon, color, description, isActive } = req.body;
    const [updated] = await db.update(specialBadgesTable).set({
      ...(name !== undefined ? { name: name.toLowerCase().trim() } : {}),
      ...(icon !== undefined ? { icon } : {}),
      ...(color !== undefined ? { color } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(isActive !== undefined ? { isActive: Boolean(isActive) } : {}),
    }).where(eq(specialBadgesTable.id, req.params.id as string)).returning();
    if (!updated) { res.status(404).json({ error: "Badge not found" }); return; }
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /admin/gamification/badges/:id ─────────────────────────────────────
router.delete("/admin/gamification/badges/:id", authenticate, requireRole("admin", "owner"), async (req, res) => {
  try {
    await db.update(specialBadgesTable).set({ isActive: false })
      .where(eq(specialBadgesTable.id, req.params.id as string));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /admin/gamification/badges/:id/assign — give badge to user ───────────
router.post("/admin/gamification/badges/:id/assign", authenticate, requireRole("admin", "owner"), async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) { res.status(400).json({ error: "userId is required" }); return; }
    await db.insert(userSpecialBadgesTable).values({
      userId, badgeId: req.params.id as string, assignedBy: req.user!.userId,
    }).onConflictDoNothing();
    res.status(201).json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /admin/gamification/badges/:id/users/:userId — revoke badge ────────
router.delete("/admin/gamification/badges/:id/users/:userId", authenticate, requireRole("admin", "owner"), async (req, res) => {
  try {
    await db.delete(userSpecialBadgesTable).where(
      and(eq(userSpecialBadgesTable.badgeId, req.params.id as string), eq(userSpecialBadgesTable.userId, req.params.userId as string)),
    );
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /admin/gamification/badges/:id/users — list users with this badge ─────
router.get("/admin/gamification/badges/:id/users", authenticate, requireRole("admin", "owner"), async (req, res) => {
  try {
    const { usersTable } = await import("@workspace/db");
    const rows = await db.select({
      assignedAt: userSpecialBadgesTable.assignedAt,
      userId: usersTable.id, username: usersTable.username,
      displayName: usersTable.displayName, avatar: usersTable.avatar,
    })
      .from(userSpecialBadgesTable)
      .innerJoin(usersTable, eq(userSpecialBadgesTable.userId, usersTable.id))
      .where(eq(userSpecialBadgesTable.badgeId, req.params.id as string))
      .orderBy(desc(userSpecialBadgesTable.assignedAt));
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// LEVEL CONFIG MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

// ── GET /admin/gamification/config ───────────────────────────────────────────
router.get("/admin/gamification/config", authenticate, requireRole("admin", "owner"), async (req, res) => {
  try {
    const [config] = await db.select().from(gamificationConfigTable).limit(1);
    const tiers = await db.select().from(levelBadgeTiersTable).orderBy(asc(levelBadgeTiersTable.minLevel));
    res.json({ config: config ?? { baseExp: 100, stepExp: 50, growthMultiplier: 1.0, multiplierInterval: 5, maxLevel: 0 }, tiers });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /admin/gamification/config ────────────────────────────────────────────
router.put("/admin/gamification/config", authenticate, requireRole("admin", "owner"), async (req, res) => {
  try {
    const { baseExp, stepExp, growthMultiplier, multiplierInterval, maxLevel } = req.body;
    const [existing] = await db.select().from(gamificationConfigTable).limit(1);
    const [updated] = await (existing
      ? db.update(gamificationConfigTable).set({
          baseExp: Number(baseExp) ?? existing.baseExp,
          stepExp: Number(stepExp) ?? existing.stepExp,
          growthMultiplier: Number(growthMultiplier) ?? existing.growthMultiplier,
          multiplierInterval: Number(multiplierInterval) ?? existing.multiplierInterval,
          maxLevel: Number(maxLevel) ?? existing.maxLevel,
          updatedAt: new Date(),
        }).where(eq(gamificationConfigTable.id, existing.id)).returning()
      : db.insert(gamificationConfigTable).values({
          baseExp: Number(baseExp) || 100,
          stepExp: Number(stepExp) || 50,
          growthMultiplier: Number(growthMultiplier) || 1.0,
          multiplierInterval: Number(multiplierInterval) || 5,
          maxLevel: Number(maxLevel) || 0,
        }).returning()
    );
    clearConfigCache();
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /admin/gamification/tiers ────────────────────────────────────────────
router.post("/admin/gamification/tiers", authenticate, requireRole("admin", "owner"), async (req, res) => {
  try {
    const { name, icon, color, minLevel, sortOrder } = req.body;
    if (!name || minLevel === undefined) { res.status(400).json({ error: "name, minLevel required" }); return; }
    const [created] = await db.insert(levelBadgeTiersTable).values({
      name, icon: icon ?? "🆕", color: color ?? "#94a3b8",
      minLevel: Number(minLevel), sortOrder: Number(sortOrder) || 0,
    }).returning();
    clearTierCache();
    res.status(201).json(created);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /admin/gamification/tiers/:id ─────────────────────────────────────────
router.put("/admin/gamification/tiers/:id", authenticate, requireRole("admin", "owner"), async (req, res) => {
  try {
    const { name, icon, color, minLevel, sortOrder } = req.body;
    const [updated] = await db.update(levelBadgeTiersTable).set({
      ...(name !== undefined ? { name } : {}),
      ...(icon !== undefined ? { icon } : {}),
      ...(color !== undefined ? { color } : {}),
      ...(minLevel !== undefined ? { minLevel: Number(minLevel) } : {}),
      ...(sortOrder !== undefined ? { sortOrder: Number(sortOrder) } : {}),
    }).where(eq(levelBadgeTiersTable.id, req.params.id as string)).returning();
    clearTierCache();
    if (!updated) { res.status(404).json({ error: "Tier not found" }); return; }
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /admin/gamification/tiers/:id ──────────────────────────────────────
router.delete("/admin/gamification/tiers/:id", authenticate, requireRole("admin", "owner"), async (req, res) => {
  try {
    await db.delete(levelBadgeTiersTable).where(eq(levelBadgeTiersTable.id, req.params.id as string));
    clearTierCache();
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// LEVEL REWARDS MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

// ── GET /admin/gamification/level-rewards ────────────────────────────────────
router.get("/admin/gamification/level-rewards", authenticate, requireRole("admin", "owner"), async (req, res) => {
  try {
    const rewards = await db.select().from(levelRewardsTable).orderBy(asc(levelRewardsTable.level));
    res.json(rewards);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /admin/gamification/level-rewards ────────────────────────────────────
router.post("/admin/gamification/level-rewards", authenticate, requireRole("admin", "owner"), async (req, res) => {
  try {
    const { level, rewardType, rewardValue, description } = req.body;
    if (!level) { res.status(400).json({ error: "level is required" }); return; }
    const [created] = await db.insert(levelRewardsTable).values({
      level: Number(level), rewardType: rewardType ?? "profile_frame",
      rewardValue: rewardValue ?? null, description: description ?? null,
    }).returning();
    res.status(201).json(created);
  } catch (err: any) {
    if (err?.code === "23505") { res.status(409).json({ error: "Reward for this level already exists" }); return; }
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /admin/gamification/level-rewards/:id ─────────────────────────────
router.delete("/admin/gamification/level-rewards/:id", authenticate, requireRole("admin", "owner"), async (req, res) => {
  try {
    await db.delete(levelRewardsTable).where(eq(levelRewardsTable.id, req.params.id as string));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// EXP MANAGEMENT (manual adjustment with audit log)
// ═══════════════════════════════════════════════════════════════════════════

// ── POST /admin/gamification/adjust-exp — manual EXP adjustment ───────────────
router.post("/admin/gamification/adjust-exp", authenticate, requireRole("admin", "owner"), async (req, res) => {
  try {
    const { userId, amount, reason } = req.body;
    if (!userId || !amount || !reason) {
      res.status(400).json({ error: "userId, amount, reason are required" });
      return;
    }
    const adjAmount = parseInt(amount, 10);
    if (isNaN(adjAmount) || adjAmount === 0) {
      res.status(400).json({ error: "amount must be a non-zero integer" });
      return;
    }

    await ensureUserLevel(userId);

    // Record audit log FIRST
    await db.insert(expAuditLogsTable).values({
      adminId: req.user!.userId,
      userId, amount: adjAmount, reason,
    });

    // Award (or deduct) EXP via the engine with admin_adjustment source
    const result = await awardExp(
      userId, "admin_adjustment", `admin_${req.user!.userId}_${Date.now()}`,
      adjAmount, { adminId: req.user!.userId, reason },
    );

    res.json({ ok: true, result });
  } catch (err: any) {
    logger.error({ err }, "POST /admin/gamification/adjust-exp");
    res.status(500).json({ error: err.message });
  }
});

// ── GET /admin/gamification/audit-logs ───────────────────────────────────────
router.get("/admin/gamification/audit-logs", authenticate, requireRole("admin", "owner"), async (req, res) => {
  try {
    const limit = Math.min(200, parseInt(req.query.limit as string) || 50);
    const { usersTable } = await import("@workspace/db");
    const logs = await db.select({
      id: expAuditLogsTable.id,
      adminId: expAuditLogsTable.adminId,
      adminUsername: usersTable.username,
      userId: expAuditLogsTable.userId,
      amount: expAuditLogsTable.amount,
      reason: expAuditLogsTable.reason,
      createdAt: expAuditLogsTable.createdAt,
    })
      .from(expAuditLogsTable)
      .innerJoin(usersTable, eq(expAuditLogsTable.adminId, usersTable.id))
      .orderBy(desc(expAuditLogsTable.createdAt))
      .limit(limit);
    res.json(logs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /admin/gamification/user/:userId — admin view of user gamification ───
router.get("/admin/gamification/user/:userId", authenticate, requireRole("admin", "owner"), async (req, res) => {
  try {
    const { getUserGamification } = await import("../lib/gamification");
    const data = await getUserGamification(req.params.userId as string);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
