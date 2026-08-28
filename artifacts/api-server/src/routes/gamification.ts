/**
 * Gamification routes — user-facing endpoints for levels, EXP, achievements,
 * badges, statistics, and privacy settings.
 */

import { Router } from "express";
import { db } from "@workspace/db";
import {
  achievementsTable, userAchievementsTable, specialBadgesTable,
  userSpecialBadgesTable, userShowcaseBadgesTable, userPrivacySettingsTable,
  levelRewardsTable, expTransactionsTable, userLevelsTable,
} from "@workspace/db";
import { eq, and, asc, desc, sql } from "drizzle-orm";
import { authenticate } from "../middlewares/auth";
import {
  getUserGamification, getPublicGamification, getUserBadgeInfo,
  awardExp, ensureUserLevel, levelFromExp, getLevelBadge,
} from "../lib/gamification";
import { logger } from "../lib/logger";

const router = Router();

const MAX_SHOWCASE = 5;

// ── GET /gamification/me — full gamification profile for current user ────────
router.get("/gamification/me", authenticate, async (req, res) => {
  try {
    const data = await getUserGamification(req.user!.userId);
    res.json(data);
  } catch (err: any) {
    logger.error({ err }, "GET /gamification/me");
    res.status(500).json({ error: err.message });
  }
});

// ── GET /gamification/badge-info/:userId — compact badge info for display ────
router.get("/gamification/badge-info/:userId", async (req, res) => {
  try {
    const data = await getUserBadgeInfo(req.params.userId);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /gamification/public/:userId — public gamification (respects privacy) ─
router.get("/gamification/public/:userId", async (req, res) => {
  try {
    const data = await getPublicGamification(req.params.userId);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /gamification/achievements — list all active achievements ─────────────
router.get("/gamification/achievements", authenticate, async (req, res) => {
  try {
    const all = await db.select().from(achievementsTable)
      .where(eq(achievementsTable.isActive, true))
      .orderBy(asc(achievementsTable.rarity), asc(achievementsTable.requirementValue));

    // Get user's unlocked achievements
    const unlocked = await db.select({
      achievementId: userAchievementsTable.achievementId,
      unlockedAt: userAchievementsTable.unlockedAt,
    })
      .from(userAchievementsTable)
      .where(eq(userAchievementsTable.userId, req.user!.userId));
    const unlockedMap = new Map(unlocked.map(u => [u.achievementId, u.unlockedAt]));

    // Get user stats for progress
    const gamification = await getUserGamification(req.user!.userId);
    const stats = gamification.statistics;
    const level = gamification.level;

    const statValues: Record<string, number> = {
      first_watch: stats.videosWatched, watch_count: stats.videosWatched,
      first_like: stats.videosLiked, like_count: stats.videosLiked,
      comment_count: stats.commentsPosted, message_count: stats.messagesSent,
      group_count: stats.groupsJoined, upload_count: stats.videosUploaded,
      first_upload: stats.videosUploaded,
      level, streak: gamification.streakDays,
    };

    // ── Creator-specific stat values (require DB queries) ───────────────────
    const creatorAchTypes = all.filter(a =>
      ["creator_likes", "premium_sale", "creator_revenue"].includes(a.requirementType)
    );
    if (creatorAchTypes.length > 0) {
      const { pool } = await import("@workspace/db");
      if (creatorAchTypes.some(a => a.requirementType === "creator_likes")) {
        const { rows } = await pool.query(
          `SELECT COALESCE(SUM(v.likes), 0) AS total FROM videos v WHERE v.creator_id = $1 AND v.deleted_at IS NULL`,
          [req.user!.userId],
        );
        statValues.creator_likes = parseInt(rows[0]?.total ?? "0", 10);
      }
      const revenueTypes = creatorAchTypes.filter(a =>
        ["premium_sale", "creator_revenue"].includes(a.requirementType)
      );
      if (revenueTypes.length > 0) {
        const { rows } = await pool.query(
          `SELECT COUNT(*) AS sale_count, COALESCE(SUM(creator_share), 0) AS total_revenue
           FROM revenue_shares WHERE creator_id = $1 AND payout_status = 'paid'`,
          [req.user!.userId],
        );
        statValues.premium_sale = parseInt(rows[0]?.sale_count ?? "0", 10);
        statValues.creator_revenue = parseInt(rows[0]?.total_revenue ?? "0", 10);
      }
    }

    const result = all
      .filter(a => !a.isHidden || unlockedMap.has(a.id))
      .map(a => {
        const unlockedAt = unlockedMap.get(a.id);
        const currentValue = statValues[a.requirementType] ?? 0;
        return {
          ...a,
          unlocked: !!unlockedAt,
          unlockedAt: unlockedAt ?? null,
          progress: Math.min(currentValue, a.requirementValue),
          progressPercent: a.requirementValue > 0 ? Math.min(100, Math.floor((currentValue / a.requirementValue) * 100)) : 0,
        };
      });

    res.json({ achievements: result, totalCount: result.length, unlockedCount: unlocked.length });
  } catch (err: any) {
    logger.error({ err }, "GET /gamification/achievements");
    res.status(500).json({ error: err.message });
  }
});

// ── GET /gamification/badges — list all special badges ────────────────────────
router.get("/gamification/badges", async (req, res) => {
  try {
    const badges = await db.select().from(specialBadgesTable)
      .where(eq(specialBadgesTable.isActive, true))
      .orderBy(asc(specialBadgesTable.name));
    res.json(badges);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /gamification/showcase — get current user's showcase badges ───────────
router.get("/gamification/showcase", authenticate, async (req, res) => {
  try {
    const showcase = await db.select().from(userShowcaseBadgesTable)
      .where(eq(userShowcaseBadgesTable.userId, req.user!.userId))
      .orderBy(asc(userShowcaseBadgesTable.displayOrder));
    res.json(showcase);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /gamification/showcase — set showcase badges (max 5) ─────────────────
router.put("/gamification/showcase", authenticate, async (req, res) => {
  try {
    const { badges } = req.body as { badges: Array<{ badgeType: string; badgeRef: string | null }> };
    if (!Array.isArray(badges)) {
      res.status(400).json({ error: "badges must be an array" });
      return;
    }
    if (badges.length > MAX_SHOWCASE) {
      res.status(400).json({ error: `Maximum ${MAX_SHOWCASE} showcase badges` });
      return;
    }

    // Validate that special/achievement badges are owned by the user
    for (const b of badges) {
      if (b.badgeType === "special" && b.badgeRef) {
        const [owned] = await db.select().from(userSpecialBadgesTable)
          .where(and(
            eq(userSpecialBadgesTable.userId, req.user!.userId),
            eq(userSpecialBadgesTable.badgeId, b.badgeRef),
          )).limit(1);
        if (!owned) {
          res.status(403).json({ error: "You don't own this badge" });
          return;
        }
      }
      if (b.badgeType === "achievement" && b.badgeRef) {
        const [owned] = await db.select().from(userAchievementsTable)
          .where(and(
            eq(userAchievementsTable.userId, req.user!.userId),
            eq(userAchievementsTable.achievementId, b.badgeRef),
          )).limit(1);
        if (!owned) {
          res.status(403).json({ error: "You don't own this achievement" });
          return;
        }
      }
    }

    // Replace all showcase badges
    await db.delete(userShowcaseBadgesTable)
      .where(eq(userShowcaseBadgesTable.userId, req.user!.userId));

    if (badges.length > 0) {
      await db.insert(userShowcaseBadgesTable).values(
        badges.map((b, i) => ({
          userId: req.user!.userId,
          badgeType: b.badgeType,
          badgeRef: b.badgeRef ?? null,
          displayOrder: i,
        })),
      );
    }

    res.json({ ok: true, count: badges.length });
  } catch (err: any) {
    logger.error({ err }, "PUT /gamification/showcase");
    res.status(500).json({ error: err.message });
  }
});

// ── GET /gamification/privacy — get privacy settings ─────────────────────────
router.get("/gamification/privacy", authenticate, async (req, res) => {
  try {
    await ensureUserLevel(req.user!.userId);
    const [privacy] = await db.select().from(userPrivacySettingsTable)
      .where(eq(userPrivacySettingsTable.userId, req.user!.userId)).limit(1);
    res.json(privacy ?? {
      showLevel: true, showBadges: true, showAchievements: true,
      showTotalVideo: true, showChatCount: false, showActivityStats: false,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /gamification/privacy — update privacy settings ───────────────────────
router.put("/gamification/privacy", authenticate, async (req, res) => {
  try {
    const { showLevel, showBadges, showAchievements, showTotalVideo, showChatCount, showActivityStats } = req.body as any;
    await ensureUserLevel(req.user!.userId);
    const [updated] = await db.insert(userPrivacySettingsTable).values({
      userId: req.user!.userId,
      showLevel: showLevel ?? true,
      showBadges: showBadges ?? true,
      showAchievements: showAchievements ?? true,
      showTotalVideo: showTotalVideo ?? true,
      showChatCount: showChatCount ?? false,
      showActivityStats: showActivityStats ?? false,
    }).onConflictDoUpdate({
      target: userPrivacySettingsTable.userId,
      set: {
        showLevel, showBadges, showAchievements,
        showTotalVideo, showChatCount, showActivityStats,
        updatedAt: new Date(),
      },
    }).returning();
    res.json(updated);
  } catch (err: any) {
    logger.error({ err }, "PUT /gamification/privacy");
    res.status(500).json({ error: err.message });
  }
});

// ── GET /gamification/exp-history — EXP transaction history ──────────────────
router.get("/gamification/exp-history", authenticate, async (req, res) => {
  try {
    const limit = Math.min(100, parseInt(req.query.limit as string) || 50);
    const transactions = await db.select().from(expTransactionsTable)
      .where(eq(expTransactionsTable.userId, req.user!.userId))
      .orderBy(desc(expTransactionsTable.createdAt))
      .limit(limit);
    res.json(transactions);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /gamification/level-info — current level details ──────────────────────
router.get("/gamification/level-info", authenticate, async (req, res) => {
  try {
    await ensureUserLevel(req.user!.userId);
    const [ul] = await db.select().from(userLevelsTable)
      .where(eq(userLevelsTable.userId, req.user!.userId)).limit(1);
    const totalExp = ul?.totalExp ?? 0;
    const { level, currentLevelExp, nextLevelExp } = await levelFromExp(totalExp);
    const levelBadge = await getLevelBadge(level);

    // Check for level reward
    const [reward] = await db.select().from(levelRewardsTable)
      .where(eq(levelRewardsTable.level, level)).limit(1);

    res.json({
      level, totalExp, currentLevelExp, nextLevelExp,
      expToNext: nextLevelExp - currentLevelExp,
      levelBadge,
      reward: reward ?? null,
      streakDays: ul?.streakDays ?? 0,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
