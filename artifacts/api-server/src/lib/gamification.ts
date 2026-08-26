/**
 * Core gamification engine — EXP awarding, level calculation, achievement
 * checking, and badge management.
 *
 * SECURITY: This is the ONLY place that awards EXP. Frontend never sends EXP
 * values — it sends events, and this service decides validity, amount, and
 * daily limits. All awards are idempotent via reference_id deduplication.
 */

import { db, pool } from "@workspace/db";
import {
  userLevelsTable, expTransactionsTable, achievementsTable,
  userAchievementsTable, specialBadgesTable, userSpecialBadgesTable,
  userShowcaseBadgesTable, userStatisticsTable, levelRewardsTable,
  expAuditLogsTable, userPrivacySettingsTable, gamificationConfigTable,
  levelBadgeTiersTable, notificationsTable,
} from "@workspace/db";
import { eq, and, sql, desc, asc, gte, lte } from "drizzle-orm";
import { logger } from "./logger";

// ─── Daily EXP limits per source ──────────────────────────────────────────────

const DAILY_LIMITS: Record<string, number> = {
  watch_video: 50,
  like_video: 20,
  comment: 20,
  send_message: 10,
  upload_video: 30,
  login: 10,   // once per day anyway
  join_group: 25,
};

// ─── EXP amounts per source ───────────────────────────────────────────────────

const EXP_AMOUNTS: Record<string, number> = {
  login: 10,
  watch_video: 5,
  like_video: 2,
  comment: 3,
  send_message: 1,
  join_group: 5,
  upload_video: 10,
};

// ─── Level formula ────────────────────────────────────────────────────────────

let _configCache: any = null;
let _configCacheTime = 0;

async function getConfig(): Promise<any> {
  const now = Date.now();
  if (_configCache && now - _configCacheTime < 60_000) return _configCache;
  try {
    const [row] = await db.select().from(gamificationConfigTable).limit(1);
    _configCache = row ?? { baseExp: 100, stepExp: 50, growthMultiplier: 1.0, multiplierInterval: 5, maxLevel: 0 };
    _configCacheTime = now;
    return _configCache;
  } catch {
    return { baseExp: 100, stepExp: 50, growthMultiplier: 1.0, multiplierInterval: 5, maxLevel: 0 };
  }
}

/** Clear the config cache (call after admin updates config). */
export function clearConfigCache(): void {
  _configCache = null;
  _configCacheTime = 0;
}

/**
 * EXP needed to advance from `level` to `level + 1`.
 * Formula: baseExp + (level - 1) * stepExp, with a multiplier applied
 * every `multiplierInterval` levels for progressive scaling.
 */
export async function expToNextLevel(level: number): Promise<number> {
  const cfg = await getConfig();
  const base = cfg.baseExp ?? 100;
  const step = cfg.stepExp ?? 50;
  const mult = cfg.growthMultiplier ?? 1.0;
  const interval = cfg.multiplierInterval ?? 5;

  let exp = base + (level - 1) * step;
  if (mult > 1.0 && interval > 0) {
    const tiers = Math.floor((level - 1) / interval);
    exp = Math.floor(exp * Math.pow(mult, tiers));
  }
  return exp;
}

/** Total cumulative EXP required to reach a given level from 0. */
export async function totalExpForLevel(level: number): Promise<number> {
  let total = 0;
  for (let l = 1; l < level; l++) {
    total += await expToNextLevel(l);
  }
  return total;
}

/** Calculate the level for a given total EXP. */
export async function levelFromExp(totalExp: number): Promise<{ level: number; currentLevelExp: number; nextLevelExp: number }> {
  const cfg = await getConfig();
  const maxLevel = cfg.maxLevel ?? 0;

  let level = 1;
  let remaining = totalExp;

  while (true) {
    if (maxLevel > 0 && level >= maxLevel) break;
    const needed = await expToNextLevel(level);
    if (remaining < needed) break;
    remaining -= needed;
    level++;
  }

  const needed = await expToNextLevel(level);
  return { level, currentLevelExp: remaining, nextLevelExp: needed };
}

// ─── Level badge tiers ────────────────────────────────────────────────────────

let _tierCache: any[] | null = null;
let _tierCacheTime = 0;

async function getLevelBadgeTiers(): Promise<any[]> {
  const now = Date.now();
  if (_tierCache && now - _tierCacheTime < 60_000) return _tierCache;
  try {
    const rows = await db.select().from(levelBadgeTiersTable).orderBy(asc(levelBadgeTiersTable.minLevel));
    if (rows.length > 0) {
      _tierCache = rows;
      _tierCacheTime = now;
      return rows;
    }
  } catch { /* table may not exist yet */ }

  // Default tiers
  const defaults = [
    { name: "Newbie",   icon: "🆕", color: "#94a3b8", minLevel: 1,  sortOrder: 0 },
    { name: "Explorer", icon: "🧭", color: "#3b82f6", minLevel: 5,  sortOrder: 1 },
    { name: "Active",   icon: "⚡", color: "#8b5cf6", minLevel: 10, sortOrder: 2 },
    { name: "Pro",      icon: "🔥", color: "#ec4899", minLevel: 20, sortOrder: 3 },
    { name: "Expert",   icon: "💎", color: "#f59e0b", minLevel: 30, sortOrder: 4 },
    { name: "Legend",   icon: "👑", color: "#eab308", minLevel: 50, sortOrder: 5 },
  ];
  _tierCache = defaults;
  _tierCacheTime = now;
  return defaults;
}

export function clearTierCache(): void {
  _tierCache = null;
  _tierCacheTime = 0;
}

/** Get the level badge tier for a given level. */
export async function getLevelBadge(level: number): Promise<{ name: string; icon: string; color: string; minLevel: number }> {
  const tiers = await getLevelBadgeTiers();
  let result = tiers[0];
  for (const tier of tiers) {
    if (level >= tier.minLevel) result = tier;
  }
  return result;
}

// ─── Ensure user records exist ────────────────────────────────────────────────

export async function ensureUserLevel(userId: string): Promise<void> {
  await db.insert(userLevelsTable).values({ userId }).onConflictDoNothing();
  await db.insert(userStatisticsTable).values({ userId }).onConflictDoNothing();
  await db.insert(userPrivacySettingsTable).values({ userId }).onConflictDoNothing();
}

// ─── Core: Award EXP ───────────────────────────────────────────────────────────

export interface AwardResult {
  awarded: boolean;
  amount: number;
  newTotalExp: number;
  newLevel: number;
  leveledUp: boolean;
  oldLevel: number;
  unlockedAchievements: any[];
  dailyLimitReached: boolean;
}

/**
 * Award EXP to a user. This is the single entry point for all EXP grants.
 *
 * Anti-abuse measures:
 * - reference_id deduplication: same (user, source, reference) only awards once
 * - daily limits per source (reset at UTC midnight)
 * - all logic server-side, frontend never sends amounts
 *
 * @param userId      Target user
 * @param source      EXP source enum value
 * @param referenceId Unique idempotency key (e.g. video_id for watch, message_id for chat)
 * @param amount       Override default amount (optional, for achievements)
 * @param metadata     Extra context stored in the transaction
 */
export async function awardExp(
  userId: string,
  source: string,
  referenceId: string | null,
  amount?: number,
  metadata?: any,
): Promise<AwardResult> {
  await ensureUserLevel(userId);

  const expAmount = amount ?? EXP_AMOUNTS[source] ?? 0;
  if (expAmount <= 0) {
    return {
      awarded: false, amount: 0, newTotalExp: 0, newLevel: 1,
      leveledUp: false, oldLevel: 1, unlockedAchievements: [], dailyLimitReached: false,
    };
  }

  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [userId]);

    // ── Idempotency check: if referenceId is set, check for existing transaction ──
    if (referenceId) {
      const { rows } = await client.query(
        `SELECT id FROM exp_transactions WHERE user_id = $1 AND source = $2 AND reference_id = $3 LIMIT 1`,
        [userId, source, referenceId],
      );
      if (rows.length > 0) {
        // Already awarded — return current state without re-awarding
        const [ul] = await db.select().from(userLevelsTable).where(eq(userLevelsTable.userId, userId)).limit(1);
        return {
          awarded: false, amount: 0,
          newTotalExp: ul?.totalExp ?? 0,
          newLevel: ul?.currentLevel ?? 1,
          leveledUp: false, oldLevel: ul?.currentLevel ?? 1,
          unlockedAchievements: [], dailyLimitReached: false,
        };
      }
    }

    // ── Daily limit check ──────────────────────────────────────────────────────
    const today = new Date().toISOString().slice(0, 10);
    const dailyLimit = DAILY_LIMITS[source];

    if (dailyLimit && source !== "login" && source !== "achievement" && source !== "admin_adjustment" && source !== "level_reward") {
      const { rows } = await client.query(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM exp_transactions
         WHERE user_id = $1 AND source = $2 AND created_at >= $3::date AND created_at < ($3::date + INTERVAL '1 day')`,
        [userId, source, today],
      );
      const earnedToday = parseInt(rows[0]?.total ?? "0", 10);
      if (earnedToday + expAmount > dailyLimit) {
        // Daily limit reached — don't award but still check achievements
        const achievements = await checkAchievements(userId, source);
        const [ul] = await db.select().from(userLevelsTable).where(eq(userLevelsTable.userId, userId)).limit(1);
        return {
          awarded: false, amount: 0,
          newTotalExp: ul?.totalExp ?? 0,
          newLevel: ul?.currentLevel ?? 1,
          leveledUp: false, oldLevel: ul?.currentLevel ?? 1,
          unlockedAchievements: achievements,
          dailyLimitReached: true,
        };
      }
    }

    // ── Record the transaction ─────────────────────────────────────────────────
    await client.query(
      `INSERT INTO exp_transactions (user_id, amount, source, reference_id, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, expAmount, source, referenceId, metadata ? JSON.stringify(metadata) : null],
    );

    // ── Update user_levels ──────────────────────────────────────────────────────
    const { rows: ulRows } = await client.query(
      `SELECT total_exp, current_level, exp_today, exp_today_date, lifetime_exp FROM user_levels WHERE user_id = $1`,
      [userId],
    );
    const ul = ulRows[0];
    const oldLevel = ul?.current_level ?? 1;
    const newTotalExp = (ul?.total_exp ?? 0) + expAmount;
    const newLifetimeExp = (ul?.lifetime_exp ?? 0) + expAmount;

    // Reset daily counter if new day
    const expTodayDate = ul?.exp_today_date;
    const newExpToday = (expTodayDate === today ? (ul?.exp_today ?? 0) : 0) + expAmount;

    // Calculate new level
    const { level: newLevel } = await levelFromExp(newTotalExp);
    const leveledUp = newLevel > oldLevel;

    await client.query(
      `UPDATE user_levels SET
         total_exp = $2, current_level = $3, exp_today = $4, exp_today_date = $5,
         lifetime_exp = $6, last_exp_activity = NOW(), updated_at = NOW()
       WHERE user_id = $1`,
      [userId, newTotalExp, newLevel, newExpToday, today, newLifetimeExp],
    );

    // ── Update user_statistics ──────────────────────────────────────────────────
    await updateStatistics(userId, source);

    // ── Check achievements ──────────────────────────────────────────────────────
    const unlockedAchievements = await checkAchievements(userId, source);

    // ── Level-up rewards & notification ────────────────────────────────────────
    if (leveledUp) {
      await onLevelUp(userId, oldLevel, newLevel, client);
    }

    return {
      awarded: true, amount: expAmount,
      newTotalExp, newLevel, leveledUp, oldLevel,
      unlockedAchievements, dailyLimitReached: false,
    };
  } catch (err: any) {
    // If it's a unique constraint violation on reference_id, it's a duplicate — safe
    if (err?.code === "23505") {
      const [ul] = await db.select().from(userLevelsTable).where(eq(userLevelsTable.userId, userId)).limit(1);
      return {
        awarded: false, amount: 0,
        newTotalExp: ul?.totalExp ?? 0,
        newLevel: ul?.currentLevel ?? 1,
        leveledUp: false, oldLevel: ul?.currentLevel ?? 1,
        unlockedAchievements: [], dailyLimitReached: false,
      };
    }
    logger.error({ err, userId, source }, "awardExp: failed");
    throw err;
  } finally {
    client.release();
  }
}

// ─── Update statistics counters ───────────────────────────────────────────────

async function updateStatistics(userId: string, source: string): Promise<void> {
  const colMap: Record<string, string> = {
    watch_video: "videos_watched",
    like_video: "videos_liked",
    comment: "comments_posted",
    send_message: "messages_sent",
    join_group: "groups_joined",
    upload_video: "videos_uploaded",
  };
  const col = colMap[source];
  if (!col) return;
  // Use raw pool query — column name is from a hardcoded map (safe from injection)
  await pool.query(
    `UPDATE user_statistics SET ${col} = ${col} + 1, updated_at = NOW() WHERE user_id = $1`,
    [userId],
  ).catch(() => {});
}

// ─── Achievement checking ─────────────────────────────────────────────────────

/**
 * Check and unlock achievements for a user based on the triggering source.
 * Returns the list of newly unlocked achievements.
 */
export async function checkAchievements(userId: string, source: string): Promise<any[]> {
  try {
    // Get all active achievements that could be triggered by this source
    const sourceToReqType: Record<string, string[]> = {
      watch_video: ["first_watch", "watch_count"],
      like_video: ["first_like", "like_count"],
      comment: ["comment_count"],
      send_message: ["message_count"],
      join_group: ["group_count"],
      upload_video: ["upload_count"],
      login: ["streak"],
    };
    const reqTypes = sourceToReqType[source] ?? [];
    if (reqTypes.length === 0) return [];

    // Also check level-based achievements (triggered after any EXP gain)
    reqTypes.push("level");

    const achievements = await db.select().from(achievementsTable)
      .where(and(
        eq(achievementsTable.isActive, true),
        sql`${achievementsTable.requirementType} = ANY(${sql.raw(`ARRAY[${reqTypes.map(t => `'${t}'`).join(",")}]::text[]`)})`,
      ));

    if (achievements.length === 0) return [];

    // Get current stats
    const [stats] = await db.select().from(userStatisticsTable)
      .where(eq(userStatisticsTable.userId, userId)).limit(1);
    const [ul] = await db.select().from(userLevelsTable)
      .where(eq(userLevelsTable.userId, userId)).limit(1);

    // Get already-unlocked achievement IDs
    const unlocked = await db.select({ achievementId: userAchievementsTable.achievementId })
      .from(userAchievementsTable).where(eq(userAchievementsTable.userId, userId));
    const unlockedIds = new Set(unlocked.map(u => u.achievementId));

    const statValues: Record<string, number> = {
      watch_count: stats?.videosWatched ?? 0,
      like_count: stats?.videosLiked ?? 0,
      comment_count: stats?.commentsPosted ?? 0,
      message_count: stats?.messagesSent ?? 0,
      group_count: stats?.groupsJoined ?? 0,
      upload_count: stats?.videosUploaded ?? 0,
      first_watch: stats?.videosWatched ?? 0,
      first_like: stats?.videosLiked ?? 0,
      level: ul?.currentLevel ?? 1,
      streak: ul?.streakDays ?? 0,
    };

    const newlyUnlocked: any[] = [];

    for (const ach of achievements) {
      if (unlockedIds.has(ach.id)) continue;

      const currentValue = statValues[ach.requirementType] ?? 0;
      if (currentValue >= ach.requirementValue) {
        // Unlock it
        try {
          await db.insert(userAchievementsTable).values({
            userId, achievementId: ach.id,
          }).onConflictDoNothing();

          newlyUnlocked.push(ach);

          // Award achievement EXP (with idempotency via achievement ID)
          if (ach.expReward > 0) {
            await awardExp(userId, "achievement", `achievement_${ach.id}`, ach.expReward, { achievementId: ach.id, achievementName: ach.name });
          }

          // Grant badge reward if specified
          if (ach.badgeReward) {
            await grantBadgeByName(userId, ach.badgeReward, null);
          }

          // Send notification
          await db.insert(notificationsTable).values({
            userId,
            title: "🎉 Achievement Unlocked!",
            message: `${ach.icon} ${ach.name} — ${ach.description}${ach.expReward > 0 ? ` (+${ach.expReward} EXP)` : ""}`,
            type: "success",
            category: "activity",
            referenceType: "achievement",
            referenceId: ach.id,
            actionUrl: "/achievements",
          }).catch(() => {});
        } catch (err: any) {
          if (err?.code !== "23505") {
            logger.error({ err, achievementId: ach.id, userId }, "checkAchievements: unlock failed");
          }
        }
      }
    }

    return newlyUnlocked;
  } catch (err: any) {
    logger.error({ err, userId, source }, "checkAchievements: failed");
    return [];
  }
}

// ─── Level-up handling ─────────────────────────────────────────────────────────

async function onLevelUp(userId: string, oldLevel: number, newLevel: number, client: any): Promise<void> {
  // Check for level rewards
  try {
    const { rows: rewards } = await client.query(
      `SELECT * FROM level_rewards WHERE level = $1`, [newLevel],
    );
    for (const reward of rewards) {
      // Send notification for the reward
      await db.insert(notificationsTable).values({
        userId,
        title: "✨ Level Up!",
        message: `Selamat! Kamu naik ke Level ${newLevel}!${reward.description ? ` Reward: ${reward.description}` : ""}`,
        type: "success",
        category: "activity",
        referenceType: "level",
        referenceId: String(newLevel),
        actionUrl: "/statistics",
      }).catch(() => {});
    }

    if (rewards.length === 0) {
      await db.insert(notificationsTable).values({
        userId,
        title: "✨ Level Up!",
        message: `Selamat! Kamu naik ke Level ${newLevel}! Teruskan perjalananmu!`,
        type: "success",
        category: "activity",
        referenceType: "level",
        referenceId: String(newLevel),
        actionUrl: "/statistics",
      }).catch(() => {});
    }
  } catch (err: any) {
    logger.error({ err, userId, oldLevel, newLevel }, "onLevelUp: failed");
  }
}

// ─── Badge management ──────────────────────────────────────────────────────────

/** Grant a special badge to a user by badge name (idempotent). */
export async function grantBadgeByName(userId: string, badgeName: string, assignedBy: string | null): Promise<void> {
  const [badge] = await db.select().from(specialBadgesTable)
    .where(eq(specialBadgesTable.name, badgeName)).limit(1);
  if (!badge) return;
  await db.insert(userSpecialBadgesTable).values({
    userId, badgeId: badge.id, assignedBy,
  }).onConflictDoNothing();
}

/** Grant a special badge to a user by badge ID (idempotent). */
export async function grantBadge(userId: string, badgeId: string, assignedBy: string | null): Promise<void> {
  await db.insert(userSpecialBadgesTable).values({
    userId, badgeId, assignedBy,
  }).onConflictDoNothing();
}

/** Revoke a special badge from a user. */
export async function revokeBadge(userId: string, badgeId: string): Promise<void> {
  await db.delete(userSpecialBadgesTable).where(
    and(eq(userSpecialBadgesTable.userId, userId), eq(userSpecialBadgesTable.badgeId, badgeId)),
  );
  // Also remove from showcase
  await db.delete(userShowcaseBadgesTable).where(
    and(eq(userShowcaseBadgesTable.userId, userId), eq(userShowcaseBadgesTable.badgeType, "special"), eq(userShowcaseBadgesTable.badgeRef, badgeId)),
  );
}

// ─── Login streak ─────────────────────────────────────────────────────────────

/** Update login streak and award daily login EXP. Called on successful login. */
export async function onLogin(userId: string): Promise<void> {
  await ensureUserLevel(userId);

  const today = new Date().toISOString().slice(0, 10);
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [userId]);

    const { rows } = await client.query(
      `SELECT last_login_date, streak_days FROM user_levels WHERE user_id = $1`, [userId],
    );
    const ul = rows[0];
    if (!ul) return;

    // Already logged in today — no streak update or EXP
    if (ul.last_login_date === today) return;

    // Calculate streak
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    let newStreak = 1;
    if (ul.last_login_date === yesterday) {
      newStreak = (ul.streak_days ?? 0) + 1;
    }

    await client.query(
      `UPDATE user_levels SET last_login_date = $2, streak_days = $3, updated_at = NOW() WHERE user_id = $1`,
      [userId, today, newStreak],
    );

    // Award login EXP (idempotent: reference = today's date)
    await awardExp(userId, "login", `login_${today}`, undefined, { streak: newStreak });
  } catch (err: any) {
    logger.error({ err, userId }, "onLogin: failed");
  } finally {
    client.release();
  }
}

// ─── Get user gamification profile (for API responses) ─────────────────────────

export async function getUserGamification(userId: string): Promise<any> {
  await ensureUserLevel(userId);

  const [ul] = await db.select().from(userLevelsTable)
    .where(eq(userLevelsTable.userId, userId)).limit(1);
  const [stats] = await db.select().from(userStatisticsTable)
    .where(eq(userStatisticsTable.userId, userId)).limit(1);
  const [privacy] = await db.select().from(userPrivacySettingsTable)
    .where(eq(userPrivacySettingsTable.userId, userId)).limit(1);

  const level = ul?.currentLevel ?? 1;
  const totalExp = ul?.totalExp ?? 0;
  const { currentLevelExp, nextLevelExp } = await levelFromExp(totalExp);
  const levelBadge = await getLevelBadge(level);

  // Get showcase badges
  const showcase = await db.select().from(userShowcaseBadgesTable)
    .where(eq(userShowcaseBadgesTable.userId, userId))
    .orderBy(asc(userShowcaseBadgesTable.displayOrder));

  // Get special badges
  const specialBadges = await db.select({
    badge: specialBadgesTable,
    assignedAt: userSpecialBadgesTable.assignedAt,
  })
    .from(userSpecialBadgesTable)
    .innerJoin(specialBadgesTable, eq(userSpecialBadgesTable.badgeId, specialBadgesTable.id))
    .where(and(eq(userSpecialBadgesTable.userId, userId), eq(specialBadgesTable.isActive, true)));

  // Get achievements
  const userAch = await db.select({
    achievement: achievementsTable,
    unlockedAt: userAchievementsTable.unlockedAt,
  })
    .from(userAchievementsTable)
    .innerJoin(achievementsTable, eq(userAchievementsTable.achievementId, achievementsTable.id))
    .where(eq(userAchievementsTable.userId, userId));

  return {
    level,
    totalExp,
    currentLevelExp,
    nextLevelExp,
    expToday: ul?.expToday ?? 0,
    lifetimeExp: ul?.lifetimeExp ?? 0,
    streakDays: ul?.streakDays ?? 0,
    lastExpActivity: ul?.lastExpActivity ?? null,
    levelBadge,
    statistics: stats ?? {
      videosWatched: 0, videosLiked: 0, commentsPosted: 0,
      messagesSent: 0, groupsJoined: 0, videosUploaded: 0,
    },
    showcaseBadges: showcase,
    specialBadges: specialBadges.map(s => s.badge),
    achievements: userAch,
    achievementCount: userAch.length,
    privacy: privacy ?? {
      showLevel: true, showBadges: true, showAchievements: true,
      showTotalVideo: true, showChatCount: false, showActivityStats: false,
    },
  };
}

/** Get a compact gamification summary for display in chat/video/comment badges. */
export async function getUserBadgeInfo(userId: string): Promise<any> {
  await ensureUserLevel(userId);

  const [ul] = await db.select().from(userLevelsTable)
    .where(eq(userLevelsTable.userId, userId)).limit(1);

  const level = ul?.currentLevel ?? 1;
  const levelBadge = await getLevelBadge(level);

  // Get showcase badges (resolved to display data)
  const showcase = await db.select().from(userShowcaseBadgesTable)
    .where(eq(userShowcaseBadgesTable.userId, userId))
    .orderBy(asc(userShowcaseBadgesTable.displayOrder))
    .limit(3);

  const resolvedShowcase: any[] = [];
  for (const s of showcase) {
    if (s.badgeType === "level") {
      resolvedShowcase.push({ type: "level", icon: levelBadge.icon, name: levelBadge.name, color: levelBadge.color });
    } else if (s.badgeType === "special" && s.badgeRef) {
      const [badge] = await db.select().from(specialBadgesTable)
        .where(eq(specialBadgesTable.id, s.badgeRef)).limit(1);
      if (badge) resolvedShowcase.push({ type: "special", icon: badge.icon, name: badge.name, color: badge.color });
    } else if (s.badgeType === "achievement" && s.badgeRef) {
      const [ach] = await db.select().from(achievementsTable)
        .where(eq(achievementsTable.id, s.badgeRef)).limit(1);
      if (ach) resolvedShowcase.push({ type: "achievement", icon: ach.icon, name: ach.name, color: "#8b5cf6" });
    }
  }

  // If no showcase selected, show level badge + first special badge
  let displayBadges = resolvedShowcase;
  if (displayBadges.length === 0) {
    displayBadges = [{ type: "level", icon: levelBadge.icon, name: levelBadge.name, color: levelBadge.color }];
    const specialBadges = await db.select().from(userSpecialBadgesTable)
      .where(eq(userSpecialBadgesTable.userId, userId)).limit(1);
    if (specialBadges.length > 0) {
      const [badge] = await db.select().from(specialBadgesTable)
        .where(eq(specialBadgesTable.id, specialBadges[0].badgeId)).limit(1);
      if (badge) displayBadges.push({ type: "special", icon: badge.icon, name: badge.name, color: badge.color });
    }
  }

  return {
    userId,
    level,
    levelBadge,
    displayBadges: displayBadges.slice(0, 3),
  };
}

/** Get public gamification info (respects privacy settings). */
export async function getPublicGamification(userId: string): Promise<any> {
  await ensureUserLevel(userId);

  const [privacy] = await db.select().from(userPrivacySettingsTable)
    .where(eq(userPrivacySettingsTable.userId, userId)).limit(1);

  const [ul] = await db.select().from(userLevelsTable)
    .where(eq(userLevelsTable.userId, userId)).limit(1);
  const [stats] = await db.select().from(userStatisticsTable)
    .where(eq(userStatisticsTable.userId, userId)).limit(1);

  const level = ul?.currentLevel ?? 1;
  const levelBadge = await getLevelBadge(level);
  const { currentLevelExp, nextLevelExp } = await levelFromExp(ul?.totalExp ?? 0);

  const result: any = { userId, level: 0, levelBadge: null };

  if (privacy?.showLevel ?? true) {
    result.level = level;
    result.levelBadge = levelBadge;
    result.currentLevelExp = currentLevelExp;
    result.nextLevelExp = nextLevelExp;
  }

  if (privacy?.showBadges ?? true) {
    const badgeInfo = await getUserBadgeInfo(userId);
    result.displayBadges = badgeInfo.displayBadges;
  }

  if (privacy?.showAchievements ?? true) {
    const userAch = await db.select({ id: userAchievementsTable.achievementId })
      .from(userAchievementsTable).where(eq(userAchievementsTable.userId, userId));
    result.achievementCount = userAch.length;
  }

  if (privacy?.showTotalVideo ?? true) {
    result.videosWatched = stats?.videosWatched ?? 0;
  }

  if (privacy?.showChatCount ?? false) {
    result.messagesSent = stats?.messagesSent ?? 0;
  }

  if (privacy?.showActivityStats ?? false) {
    result.statistics = stats;
  }

  return result;
}

// ─── Seed default data ────────────────────────────────────────────────────────

export async function seedDefaultGamification(): Promise<void> {
  // Config
  const [existingConfig] = await db.select().from(gamificationConfigTable).limit(1);
  if (!existingConfig) {
    await db.insert(gamificationConfigTable).values({
      baseExp: 100, stepExp: 50, growthMultiplier: 1.0, multiplierInterval: 5, maxLevel: 0,
    }).onConflictDoNothing();
  }

  // Level badge tiers
  const existingTiers = await db.select().from(levelBadgeTiersTable).limit(1);
  if (existingTiers.length === 0) {
    await db.insert(levelBadgeTiersTable).values([
      { name: "Newbie",   icon: "🆕", color: "#94a3b8", minLevel: 1,  sortOrder: 0 },
      { name: "Explorer", icon: "🧭", color: "#3b82f6", minLevel: 5,  sortOrder: 1 },
      { name: "Active",   icon: "⚡", color: "#8b5cf6", minLevel: 10, sortOrder: 2 },
      { name: "Pro",      icon: "🔥", color: "#ec4899", minLevel: 20, sortOrder: 3 },
      { name: "Expert",   icon: "💎", color: "#f59e0b", minLevel: 30, sortOrder: 4 },
      { name: "Legend",   icon: "👑", color: "#eab308", minLevel: 50, sortOrder: 5 },
    ]).onConflictDoNothing();
  }

  // Default achievements
  const existingAch = await db.select().from(achievementsTable).limit(1);
  if (existingAch.length === 0) {
    await db.insert(achievementsTable).values([
      { name: "First Watch", description: "Tonton video pertamamu", icon: "🎬", rarity: "COMMON", requirementType: "first_watch", requirementValue: 1, expReward: 10 },
      { name: "First Like", description: "Berikan like pertamamu", icon: "❤️", rarity: "COMMON", requirementType: "first_like", requirementValue: 1, expReward: 10 },
      { name: "Chatter", description: "Kirim 100 pesan", icon: "💬", rarity: "RARE", requirementType: "message_count", requirementValue: 100, expReward: 100 },
      { name: "7 Day Streak", description: "Login selama 7 hari berturut-turut", icon: "🔥", rarity: "RARE", requirementType: "streak", requirementValue: 7, expReward: 150 },
      { name: "Creator", description: "Upload 10 video", icon: "🎥", rarity: "EPIC", requirementType: "upload_count", requirementValue: 10, expReward: 200, badgeReward: "creator" },
      { name: "Video Master", description: "Tonton 1.000 video", icon: "👑", rarity: "LEGENDARY", requirementType: "watch_count", requirementValue: 1000, expReward: 500 },
      { name: "Legend", description: "Capai Level 50", icon: "💎", rarity: "LEGENDARY", requirementType: "level", requirementValue: 50, expReward: 1000 },
      { name: "Early Member", description: "Anggota awal platform", icon: "🏆", rarity: "SPECIAL", requirementType: "first_watch", requirementValue: 0, expReward: 50, isHidden: true },
      { name: "Social Butterfly", description: "Bergabung dengan 10 grup", icon: "🦋", rarity: "RARE", requirementType: "group_count", requirementValue: 10, expReward: 100 },
      { name: "Comment Pro", description: "Posting 50 komentar", icon: "💭", rarity: "RARE", requirementType: "comment_count", requirementValue: 50, expReward: 75 },
    ]).onConflictDoNothing();
  }

  // Default special badges
  const existingBadges = await db.select().from(specialBadgesTable).limit(1);
  if (existingBadges.length === 0) {
    await db.insert(specialBadgesTable).values([
      { name: "legend", icon: "👑", color: "#eab308", description: "Legend badge" },
      { name: "creator", icon: "🎬", color: "#8b5cf6", description: "Creator badge" },
      { name: "early_member", icon: "🔥", color: "#f97316", description: "Early member" },
      { name: "top_creator", icon: "💎", color: "#3b82f6", description: "Top creator" },
      { name: "event_winner", icon: "🏆", color: "#f59e0b", description: "Event winner" },
      { name: "verified", icon: "⭐", color: "#22c55e", description: "Verified user" },
      { name: "creative", icon: "🎨", color: "#ec4899", description: "Creative contributor" },
      { name: "chat_master", icon: "💬", color: "#06b6d4", description: "Chat master" },
    ]).onConflictDoNothing();
  }
}
