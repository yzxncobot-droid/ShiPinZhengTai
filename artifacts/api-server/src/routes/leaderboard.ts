import { Router } from "express";
import { db } from "@workspace/db";
import {
  usersTable,
  viewsTable,
  likesTable,
  commentsTable,
  videosTable,
  userBadgesTable,
  topupsTable,
  creatorVerificationsTable,
  verificationHistoryTable,
  leaderboardHistoryTable,
  pointLogsTable,
} from "@workspace/db";
import { eq, and, gte, desc, sql, count, sum, isNotNull } from "drizzle-orm";
import { getOrSet, invalidateCache, TTL } from "../lib/redis";
import { authenticate, requireRole, optionalAuth } from "../middlewares/auth";

const router = Router();

// ── Point values ─────────────────────────────────────────────────────────────
const POINTS = {
  watch_video:  10,  // viewer watches a video
  like_video:    2,  // viewer gives a like
  comment:       5,  // viewer writes a comment
  upload_video: 25,  // uploader uploads a video
  video_liked:   3,  // per like received on uploader's video
  video_viewed:  1,  // per view received on uploader's video
  badge_earned: 100, // per badge in user_badges
};

function getPeriodSince(period: string): Date | null {
  const now = new Date();
  if (period === "weekly") {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    return d;
  }
  if (period === "monthly") {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 1);
    return d;
  }
  return null; // alltime — no filter
}

function userLevel(points: number): number {
  return Math.max(1, Math.floor(points / 200) + 1);
}

function rankBadge(rank: number): string | null {
  if (rank === 1) return "Golden Crown";
  if (rank === 2) return "Silver Crown";
  if (rank === 3) return "Bronze Crown";
  if (rank <= 10) return "Top Creator";
  if (rank <= 50) return "Elite Member";
  if (rank <= 100) return "Rising Star";
  return null;
}

// ── Core computation ──────────────────────────────────────────────────────────

async function computeAll(since: Date | null) {
  // Viewer points: views (×10) + likes given (×2) + comments (×5)
  const viewPoints = await db
    .select({
      userId: viewsTable.userId,
      pts: sql<number>`cast(count(*) * ${POINTS.watch_video} as int)`,
    })
    .from(viewsTable)
    .where(
      and(
        isNotNull(viewsTable.userId),
        since ? gte(viewsTable.createdAt, since) : undefined,
      ),
    )
    .groupBy(viewsTable.userId);

  const likeGivenPoints = await db
    .select({
      userId: likesTable.userId,
      pts: sql<number>`cast(count(*) * ${POINTS.like_video} as int)`,
    })
    .from(likesTable)
    .where(since ? gte(likesTable.createdAt, since) : undefined)
    .groupBy(likesTable.userId);

  const commentPoints = await db
    .select({
      userId: commentsTable.userId,
      pts: sql<number>`cast(count(*) * ${POINTS.comment} as int)`,
    })
    .from(commentsTable)
    .where(since ? gte(commentsTable.createdAt, since) : undefined)
    .groupBy(commentsTable.userId);

  // Uploader points: uploads (×25) + likes received on their videos (×3) + views on their videos (×1)
  const uploadPoints = await db
    .select({
      userId: videosTable.creatorId,
      pts: sql<number>`cast(count(*) * ${POINTS.upload_video} as int)`,
    })
    .from(videosTable)
    .where(since ? gte(videosTable.createdAt, since) : undefined)
    .groupBy(videosTable.creatorId);

  const videoLikePoints = await db
    .select({
      userId: videosTable.creatorId,
      pts: sql<number>`cast(count(*) * ${POINTS.video_liked} as int)`,
    })
    .from(likesTable)
    .innerJoin(videosTable, eq(likesTable.videoId, videosTable.id))
    .where(since ? gte(likesTable.createdAt, since) : undefined)
    .groupBy(videosTable.creatorId);

  const videoViewPoints = await db
    .select({
      userId: videosTable.creatorId,
      pts: sql<number>`cast(count(*) * ${POINTS.video_viewed} as int)`,
    })
    .from(viewsTable)
    .innerJoin(videosTable, eq(viewsTable.videoId, videosTable.id))
    .where(since ? gte(viewsTable.createdAt, since) : undefined)
    .groupBy(videosTable.creatorId);

  // Badge points
  const badgePoints = await db
    .select({
      userId: userBadgesTable.userId,
      pts: sql<number>`cast(count(*) * ${POINTS.badge_earned} as int)`,
    })
    .from(userBadgesTable)
    .groupBy(userBadgesTable.userId);

  // Aggregate all into a map
  const map = new Map<string, number>();
  const add = (userId: string | null, pts: number) => {
    if (!userId) return;
    map.set(userId, (map.get(userId) ?? 0) + pts);
  };
  for (const r of viewPoints) add(r.userId, r.pts);
  for (const r of likeGivenPoints) add(r.userId, r.pts);
  for (const r of commentPoints) add(r.userId, r.pts);
  for (const r of uploadPoints) add(r.userId, r.pts);
  for (const r of videoLikePoints) add(r.userId, r.pts);
  for (const r of videoViewPoints) add(r.userId, r.pts);
  for (const r of badgePoints) add(r.userId, r.pts);

  return map;
}

async function computeViewer(since: Date | null) {
  const viewPoints = await db
    .select({
      userId: viewsTable.userId,
      pts: sql<number>`cast(count(*) * ${POINTS.watch_video} as int)`,
    })
    .from(viewsTable)
    .where(and(isNotNull(viewsTable.userId), since ? gte(viewsTable.createdAt, since) : undefined))
    .groupBy(viewsTable.userId);

  const likeGivenPoints = await db
    .select({
      userId: likesTable.userId,
      pts: sql<number>`cast(count(*) * ${POINTS.like_video} as int)`,
    })
    .from(likesTable)
    .where(since ? gte(likesTable.createdAt, since) : undefined)
    .groupBy(likesTable.userId);

  const commentPoints = await db
    .select({
      userId: commentsTable.userId,
      pts: sql<number>`cast(count(*) * ${POINTS.comment} as int)`,
    })
    .from(commentsTable)
    .where(since ? gte(commentsTable.createdAt, since) : undefined)
    .groupBy(commentsTable.userId);

  const map = new Map<string, number>();
  const add = (userId: string | null, pts: number) => {
    if (!userId) return;
    map.set(userId, (map.get(userId) ?? 0) + pts);
  };
  for (const r of viewPoints) add(r.userId, r.pts);
  for (const r of likeGivenPoints) add(r.userId, r.pts);
  for (const r of commentPoints) add(r.userId, r.pts);
  return map;
}

async function computeUploader(since: Date | null) {
  const uploadPoints = await db
    .select({
      userId: videosTable.creatorId,
      pts: sql<number>`cast(count(*) * ${POINTS.upload_video} as int)`,
    })
    .from(videosTable)
    .where(since ? gte(videosTable.createdAt, since) : undefined)
    .groupBy(videosTable.creatorId);

  const videoLikePoints = await db
    .select({
      userId: videosTable.creatorId,
      pts: sql<number>`cast(count(*) * ${POINTS.video_liked} as int)`,
    })
    .from(likesTable)
    .innerJoin(videosTable, eq(likesTable.videoId, videosTable.id))
    .where(since ? gte(likesTable.createdAt, since) : undefined)
    .groupBy(videosTable.creatorId);

  const videoViewPoints = await db
    .select({
      userId: videosTable.creatorId,
      pts: sql<number>`cast(count(*) * ${POINTS.video_viewed} as int)`,
    })
    .from(viewsTable)
    .innerJoin(videosTable, eq(viewsTable.videoId, videosTable.id))
    .where(since ? gte(viewsTable.createdAt, since) : undefined)
    .groupBy(videosTable.creatorId);

  const map = new Map<string, number>();
  const add = (userId: string | null, pts: number) => {
    if (!userId) return;
    map.set(userId, (map.get(userId) ?? 0) + pts);
  };
  for (const r of uploadPoints) add(r.userId, r.pts);
  for (const r of videoLikePoints) add(r.userId, r.pts);
  for (const r of videoViewPoints) add(r.userId, r.pts);
  return map;
}

async function computeActivity(since: Date | null) {
  const viewCounts = await db
    .select({ userId: viewsTable.userId, cnt: count() })
    .from(viewsTable)
    .where(and(isNotNull(viewsTable.userId), since ? gte(viewsTable.createdAt, since) : undefined))
    .groupBy(viewsTable.userId);

  const likeCounts = await db
    .select({ userId: likesTable.userId, cnt: count() })
    .from(likesTable)
    .where(since ? gte(likesTable.createdAt, since) : undefined)
    .groupBy(likesTable.userId);

  const commentCounts = await db
    .select({ userId: commentsTable.userId, cnt: count() })
    .from(commentsTable)
    .where(since ? gte(commentsTable.createdAt, since) : undefined)
    .groupBy(commentsTable.userId);

  const uploadCounts = await db
    .select({ userId: videosTable.creatorId, cnt: count() })
    .from(videosTable)
    .where(since ? gte(videosTable.createdAt, since) : undefined)
    .groupBy(videosTable.creatorId);

  const map = new Map<string, number>();
  const add = (userId: string | null, n: number) => {
    if (!userId) return;
    map.set(userId, (map.get(userId) ?? 0) + n);
  };
  for (const r of viewCounts) add(r.userId, r.cnt);
  for (const r of likeCounts) add(r.userId, r.cnt);
  for (const r of commentCounts) add(r.userId, r.cnt);
  for (const r of uploadCounts) add(r.userId, r.cnt);
  return map;
}

async function computeBadge(_since: Date | null) {
  // Badge count is not period-filtered (badges are permanent)
  const rows = await db
    .select({
      userId: userBadgesTable.userId,
      cnt: count(),
    })
    .from(userBadgesTable)
    .groupBy(userBadgesTable.userId);

  const map = new Map<string, number>();
  for (const r of rows) map.set(r.userId, r.cnt * POINTS.badge_earned);
  return map;
}

async function resolveUsers(userIds: string[]) {
  if (userIds.length === 0) return new Map<string, { username: string; avatar: string | null; verificationBadge: string | null }>();
  const rows = await db
    .select({
      id: usersTable.id,
      username: usersTable.username,
      avatar: usersTable.avatar,
      verificationBadge: usersTable.verificationBadge,
    })
    .from(usersTable)
    .where(sql`${usersTable.id} = ANY(${sql.raw(`ARRAY[${userIds.map(() => "?").join(",")}]::uuid[]`)})`);
  const m = new Map<string, { username: string; avatar: string | null; verificationBadge: string | null }>();
  for (const r of rows) m.set(r.id, { username: r.username, avatar: r.avatar, verificationBadge: r.verificationBadge });
  return m;
}

async function resolveUsersById(userIds: string[]) {
  if (userIds.length === 0) return new Map<string, { username: string; avatar: string | null; verificationBadge: string | null }>();
  const rows = await db
    .select({
      id: usersTable.id,
      username: usersTable.username,
      avatar: usersTable.avatar,
      verificationBadge: usersTable.verificationBadge,
    })
    .from(usersTable);
  const m = new Map<string, { username: string; avatar: string | null; verificationBadge: string | null }>();
  for (const r of rows) {
    if (userIds.includes(r.id)) m.set(r.id, r);
  }
  return m;
}

async function buildRanking(pointMap: Map<string, number>, limit = 100) {
  const sorted = [...pointMap.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit);

  if (sorted.length === 0) return [];

  const userIds = sorted.map(([id]) => id);
  const users = await resolveUsersById(userIds);

  return sorted.map(([userId, pts], i) => {
    const rank = i + 1;
    const u = users.get(userId);
    return {
      rank,
      userId,
      username: u?.username ?? "Unknown",
      avatar: u?.avatar ?? null,
      verificationBadge: u?.verificationBadge ?? null,
      points: pts,
      level: userLevel(pts),
      rankBadge: rankBadge(rank),
    };
  });
}

// ── Cache key builder ─────────────────────────────────────────────────────────
const lbKey = (category: string, period: string) => `lb:${category}:${period}`;
const LB_TTL = 10 * 60; // 10 minutes

// ── GET /api/leaderboard  (main unified endpoint) ─────────────────────────────
router.get("/leaderboard", async (req, res) => {
  const { category = "all", period = "weekly" } = req.query as Record<string, string>;
  const since = getPeriodSince(period);
  const key = lbKey(category, period);

  try {
    const data = await getOrSet(key, LB_TTL, async () => {
      let map: Map<string, number>;
      if (category === "viewer")   map = await computeViewer(since);
      else if (category === "uploader") map = await computeUploader(since);
      else if (category === "activity") map = await computeActivity(since);
      else if (category === "badge")    map = await computeBadge(since);
      else                              map = await computeAll(since);
      return buildRanking(map);
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to compute leaderboard" });
  }
});

// Named category endpoints
router.get("/leaderboard/viewer", async (req, res) => {
  const { period = "weekly" } = req.query as Record<string, string>;
  const data = await getOrSet(lbKey("viewer", period), LB_TTL, () => computeViewer(getPeriodSince(period)).then(buildRanking));
  res.json(data);
});

router.get("/leaderboard/uploader", async (req, res) => {
  const { period = "weekly" } = req.query as Record<string, string>;
  const data = await getOrSet(lbKey("uploader", period), LB_TTL, () => computeUploader(getPeriodSince(period)).then(buildRanking));
  res.json(data);
});

router.get("/leaderboard/activity", async (req, res) => {
  const { period = "weekly" } = req.query as Record<string, string>;
  const data = await getOrSet(lbKey("activity", period), LB_TTL, () => computeActivity(getPeriodSince(period)).then(buildRanking));
  res.json(data);
});

router.get("/leaderboard/badge", async (req, res) => {
  const { period = "weekly" } = req.query as Record<string, string>;
  const data = await getOrSet(lbKey("badge", period), LB_TTL, () => computeBadge(getPeriodSince(period)).then(buildRanking));
  res.json(data);
});

// History endpoint
router.get("/leaderboard/history", async (req, res) => {
  const { category = "all", period = "weekly", limit = "20" } = req.query as Record<string, string>;
  const rows = await db
    .select({
      id: leaderboardHistoryTable.id,
      userId: leaderboardHistoryTable.userId,
      rank: leaderboardHistoryTable.rank,
      category: leaderboardHistoryTable.category,
      period: leaderboardHistoryTable.period,
      points: leaderboardHistoryTable.points,
      createdAt: leaderboardHistoryTable.createdAt,
      username: usersTable.username,
      avatar: usersTable.avatar,
    })
    .from(leaderboardHistoryTable)
    .innerJoin(usersTable, eq(leaderboardHistoryTable.userId, usersTable.id))
    .where(
      and(
        eq(leaderboardHistoryTable.category, category as any),
        eq(leaderboardHistoryTable.period, period as any),
      ),
    )
    .orderBy(desc(leaderboardHistoryTable.createdAt))
    .limit(parseInt(limit) || 20);
  res.json(rows);
});

// Topup leaderboard (legacy – keep for backward compat)
router.get("/leaderboard/topup", async (req, res) => {
  const { period = "alltime" } = req.query as Record<string, string>;
  const cacheKey = `cache:leaderboard:${period}`;

  const data = await getOrSet(cacheKey, TTL.LEADERBOARD, async () => {
    const now = new Date();
    let since: Date | null = null;
    if (period === "daily") {
      since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (period === "weekly") {
      since = new Date(now);
      since.setDate(since.getDate() - 7);
    } else if (period === "monthly") {
      since = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    const rows = await db
      .select({
        userId: topupsTable.userId,
        totalAmount: sum(topupsTable.amount),
        username: usersTable.username,
        avatar: usersTable.avatar,
        verificationBadge: usersTable.verificationBadge,
        role: usersTable.role,
      })
      .from(topupsTable)
      .innerJoin(usersTable, eq(topupsTable.userId, usersTable.id))
      .where(
        since
          ? and(eq(topupsTable.status, "confirmed"), gte(topupsTable.createdAt, since))
          : eq(topupsTable.status, "confirmed"),
      )
      .groupBy(topupsTable.userId, usersTable.username, usersTable.avatar, usersTable.verificationBadge, usersTable.role)
      .orderBy(desc(sum(topupsTable.amount)))
      .limit(50);

    const mapped = rows.map((r, i) => ({
      rank: i + 1,
      userId: r.userId,
      username: r.username,
      avatar: r.avatar,
      verificationBadge: r.verificationBadge ?? null,
      role: r.role,
      totalAmount: Number(r.totalAmount) || 0,
    }));

    if (period === "alltime" && mapped.length > 0) {
      updateSulthanBadge(mapped[0].userId, mapped[0].username).catch(() => {});
    }
    return mapped;
  });
  res.json(data);
});

// ── Admin endpoints ───────────────────────────────────────────────────────────

/** POST /api/admin/leaderboard/recalculate — invalidate all caches and snapshot history */
router.post("/admin/leaderboard/recalculate", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const categories = ["all", "viewer", "uploader", "activity", "badge"];
  const periods = ["weekly", "monthly", "alltime"];

  // Invalidate all caches
  for (const cat of categories) {
    for (const per of periods) {
      await invalidateCache(lbKey(cat, per));
    }
  }

  // Snapshot current alltime rankings into history
  for (const cat of categories) {
    try {
      let map: Map<string, number>;
      if (cat === "viewer")    map = await computeViewer(null);
      else if (cat === "uploader") map = await computeUploader(null);
      else if (cat === "activity") map = await computeActivity(null);
      else if (cat === "badge")    map = await computeBadge(null);
      else                         map = await computeAll(null);

      const ranking = await buildRanking(map, 100);
      for (const entry of ranking.slice(0, 100)) {
        await db.insert(leaderboardHistoryTable).values({
          userId: entry.userId,
          rank: entry.rank,
          category: cat as any,
          period: "alltime",
          points: entry.points,
        });
      }
    } catch (_e) {
      // continue with other categories
    }
  }

  res.json({ success: true, message: "Leaderboard recalculated and snapshots saved" });
});

/** POST /api/admin/leaderboard/reset — wipe point_logs for a period (optional, for weekly/monthly resets) */
router.post("/admin/leaderboard/reset", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const categories = ["all", "viewer", "uploader", "activity", "badge"];
  const periods = ["weekly", "monthly", "alltime"];
  for (const cat of categories) {
    for (const per of periods) {
      await invalidateCache(lbKey(cat, per));
    }
  }
  res.json({ success: true, message: "Leaderboard caches cleared" });
});

/** GET /api/admin/leaderboard/history — paginated history with all categories */
router.get("/admin/leaderboard/history", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const { page = "1", limit = "50" } = req.query as Record<string, string>;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const rows = await db
    .select({
      id: leaderboardHistoryTable.id,
      userId: leaderboardHistoryTable.userId,
      username: usersTable.username,
      avatar: usersTable.avatar,
      rank: leaderboardHistoryTable.rank,
      category: leaderboardHistoryTable.category,
      period: leaderboardHistoryTable.period,
      points: leaderboardHistoryTable.points,
      createdAt: leaderboardHistoryTable.createdAt,
    })
    .from(leaderboardHistoryTable)
    .innerJoin(usersTable, eq(leaderboardHistoryTable.userId, usersTable.id))
    .orderBy(desc(leaderboardHistoryTable.createdAt))
    .limit(parseInt(limit))
    .offset(offset);

  res.json(rows);
});

// ── Sulthan badge helper (legacy) ─────────────────────────────────────────────
async function updateSulthanBadge(newTopUserId: string, newTopUsername: string) {
  const [current] = await db
    .select({ id: creatorVerificationsTable.id, userId: creatorVerificationsTable.userId })
    .from(creatorVerificationsTable)
    .where(and(
      eq(creatorVerificationsTable.badgeType, "sulthan"),
      eq(creatorVerificationsTable.status, "active"),
    ));

  if (current?.userId === newTopUserId) return;

  if (current) {
    await db.update(creatorVerificationsTable)
      .set({ status: "revoked", revokedAt: new Date() })
      .where(eq(creatorVerificationsTable.id, current.id));

    const remaining = await db
      .select({ badgeType: creatorVerificationsTable.badgeType })
      .from(creatorVerificationsTable)
      .where(and(
        eq(creatorVerificationsTable.userId, current.userId),
        eq(creatorVerificationsTable.status, "active"),
      ));
    const priority: Record<string, number> = { sulthan: 3, gold: 2, blue: 1 };
    const best = remaining.sort((a, b) => (priority[b.badgeType] ?? 0) - (priority[a.badgeType] ?? 0))[0];
    await db.update(usersTable)
      .set({ verificationBadge: best?.badgeType ?? null, updatedAt: new Date() })
      .where(eq(usersTable.id, current.userId));

    await db.insert(verificationHistoryTable).values({
      verificationId: current.id,
      userId: current.userId,
      action: "sulthan_removed",
      badgeType: "sulthan",
      note: `${newTopUsername} became the new #1`,
    });
  }

  const [newVer] = await db.insert(creatorVerificationsTable).values({
    userId: newTopUserId,
    badgeType: "sulthan",
    reason: "Automatic — #1 on all-time topup leaderboard",
  }).returning();

  await db.update(usersTable)
    .set({ verificationBadge: "sulthan", updatedAt: new Date() })
    .where(eq(usersTable.id, newTopUserId));

  await db.insert(verificationHistoryTable).values({
    verificationId: newVer.id,
    userId: newTopUserId,
    action: "sulthan_granted",
    badgeType: "sulthan",
    note: "Automatic — #1 on all-time topup leaderboard",
  });
}

export default router;
