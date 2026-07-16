import { Router } from "express";
import { db } from "@workspace/db";
import {
  usersTable, videosTable, userSubscriptionsTable, transactionsTable,
  topupsTable, viewsTable, categoriesTable, withdrawalsTable,
} from "@workspace/db";
import { eq, and, gte, lte, desc, sum, count, sql } from "drizzle-orm";
import { authenticate, requireRole } from "../middlewares/auth";
import { getOrSet, keys, TTL, invalidateCache } from "../lib/redis";

const router = Router();

// Enhanced overview stats — cached in Redis for 5 minutes
router.get("/analytics/overview", authenticate, requireRole("owner", "admin"), async (req, res) => {
  const data = await getOrSet(keys.analytics("overview"), TTL.ANALYTICS, async () => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [{ totalUsers }] = await db.select({ totalUsers: count() }).from(usersTable);
    const [{ premiumUsers }] = await db.select({ premiumUsers: count() }).from(userSubscriptionsTable)
      .where(and(eq(userSubscriptionsTable.isActive, true), gte(userSubscriptionsTable.endDate, now)));
    const [{ adminUsers }] = await db.select({ adminUsers: count() }).from(usersTable).where(eq(usersTable.role, "admin"));
    const [{ ownerUsers }] = await db.select({ ownerUsers: count() }).from(usersTable).where(eq(usersTable.role, "owner"));
    const [{ bannedUsers }] = await db.select({ bannedUsers: count() }).from(usersTable).where(eq(usersTable.isBanned, true));
    const [{ newUsersToday }] = await db.select({ newUsersToday: count() }).from(usersTable).where(gte(usersTable.createdAt, today));
    const [{ totalVideos }] = await db.select({ totalVideos: count() }).from(videosTable);
    const [{ premiumVideos }] = await db.select({ premiumVideos: count() }).from(videosTable).where(eq(videosTable.type, "premium"));
    const [{ freeVideos }] = await db.select({ freeVideos: count() }).from(videosTable).where(eq(videosTable.type, "free"));
    const [{ newVideosToday }] = await db.select({ newVideosToday: count() }).from(videosTable).where(gte(videosTable.createdAt, today));
    const [{ totalViews }] = await db.select({ totalViews: count() }).from(viewsTable);
    const [{ totalCategories }] = await db.select({ totalCategories: count() }).from(categoriesTable);
    const [{ revenueAllTime }] = await db.select({ revenueAllTime: sum(topupsTable.amount) }).from(topupsTable).where(eq(topupsTable.status, "confirmed"));
    const [{ revenueMonth }] = await db.select({ revenueMonth: sum(topupsTable.amount) }).from(topupsTable)
      .where(and(eq(topupsTable.status, "confirmed"), gte(topupsTable.createdAt, monthStart)));
    const [{ revenueToday }] = await db.select({ revenueToday: sum(topupsTable.amount) }).from(topupsTable)
      .where(and(eq(topupsTable.status, "confirmed"), gte(topupsTable.createdAt, today)));
    const [{ pendingTopups }] = await db.select({ pendingTopups: count() }).from(topupsTable).where(eq(topupsTable.status, "pending"));
    const [{ pendingWithdrawals }] = await db.select({ pendingWithdrawals: count() }).from(withdrawalsTable).where(eq(withdrawalsTable.status, "pending"));
    const [{ totalActiveSubscriptions }] = await db.select({ totalActiveSubscriptions: count() }).from(userSubscriptionsTable)
      .where(and(eq(userSubscriptionsTable.isActive, true), gte(userSubscriptionsTable.endDate, now)));

    return {
      totalUsers: Number(totalUsers) || 0,
      premiumUsers: Number(premiumUsers) || 0,
      adminUsers: Number(adminUsers) || 0,
      ownerUsers: Number(ownerUsers) || 0,
      bannedUsers: Number(bannedUsers) || 0,
      newUsersToday: Number(newUsersToday) || 0,
      totalVideos: Number(totalVideos) || 0,
      premiumVideos: Number(premiumVideos) || 0,
      freeVideos: Number(freeVideos) || 0,
      newVideosToday: Number(newVideosToday) || 0,
      totalViews: Number(totalViews) || 0,
      totalCategories: Number(totalCategories) || 0,
      revenueAllTime: Number(revenueAllTime) || 0,
      revenueMonth: Number(revenueMonth) || 0,
      revenueToday: Number(revenueToday) || 0,
      pendingTopups: Number(pendingTopups) || 0,
      pendingWithdrawals: Number(pendingWithdrawals) || 0,
      totalActiveSubscriptions: Number(totalActiveSubscriptions) || 0,
    };
  });
  res.json(data);
});

// Top videos by views
router.get("/analytics/videos", authenticate, requireRole("owner", "admin"), async (_req, res) => {
  const data = await getOrSet(keys.analytics("videos"), TTL.ANALYTICS, async () => {
    return db.select().from(videosTable).orderBy(desc(videosTable.views)).limit(20);
  });
  res.json(data);
});

// Revenue time-series
router.get("/analytics/revenue", authenticate, requireRole("owner", "admin"), async (req, res) => {
  const { period = "monthly" } = req.query as Record<string, string>;
  const cacheKey = keys.analytics(`revenue:${period}`);

  const data = await getOrSet(cacheKey, TTL.ANALYTICS, async () => {
    const now = new Date();
    let since: Date;
    let groupFmt: string;

    if (period === "daily") {
      since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
      groupFmt = "YYYY-MM-DD";
    } else if (period === "weekly") {
      since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 83);
      groupFmt = "IYYY-IW";
    } else {
      since = new Date(now.getFullYear() - 1, now.getMonth(), 1);
      groupFmt = "YYYY-MM";
    }

    const rows = await db.execute(
      sql`SELECT to_char(created_at, ${groupFmt}) as period, SUM(amount) as revenue, COUNT(*) as count
          FROM topups WHERE status = 'confirmed' AND created_at >= ${since}
          GROUP BY 1 ORDER BY 1`,
    );
    return rows.rows;
  });
  res.json(data);
});

// Recent activity
router.get("/analytics/activity", authenticate, requireRole("owner", "admin"), async (_req, res) => {
  const rows = await db
    .select({
      id: transactionsTable.id,
      userId: transactionsTable.userId,
      type: transactionsTable.type,
      amount: transactionsTable.amount,
      description: transactionsTable.description,
      createdAt: transactionsTable.createdAt,
      user: {
        id: usersTable.id,
        username: usersTable.username,
        avatar: usersTable.avatar,
      },
    })
    .from(transactionsTable)
    .innerJoin(usersTable, eq(transactionsTable.userId, usersTable.id))
    .orderBy(desc(transactionsTable.createdAt))
    .limit(20);
  res.json(rows);
});

// Admin-specific stats for creator
router.get("/analytics/admin-stats", authenticate, requireRole("owner", "admin"), async (req, res) => {
  const userId = req.user!.userId;
  const cacheKey = keys.analytics(`admin-stats:${userId}`);

  const data = await getOrSet(cacheKey, TTL.ANALYTICS, async () => {
    const [{ totalVideos }] = await db.select({ totalVideos: count() }).from(videosTable).where(eq(videosTable.creatorId, userId));
    const [{ totalViews }] = await db.select({ totalViews: sum(videosTable.views) }).from(videosTable).where(eq(videosTable.creatorId, userId));
    const [{ totalLikes }] = await db.select({ totalLikes: sum(videosTable.likes) }).from(videosTable).where(eq(videosTable.creatorId, userId));
    return {
      totalVideos: Number(totalVideos) || 0,
      totalViews: Number(totalViews) || 0,
      totalLikes: Number(totalLikes) || 0,
    };
  });
  res.json(data);
});

// Invalidate analytics cache (useful after bulk operations)
router.post("/analytics/invalidate-cache", authenticate, requireRole("owner"), async (_req, res) => {
  await Promise.all([
    invalidateCache(keys.analytics("overview")),
    invalidateCache(keys.analytics("videos")),
    invalidateCache(keys.analytics("revenue:daily")),
    invalidateCache(keys.analytics("revenue:weekly")),
    invalidateCache(keys.analytics("revenue:monthly")),
  ]);
  res.json({ message: "Analytics cache invalidated" });
});

export default router;
