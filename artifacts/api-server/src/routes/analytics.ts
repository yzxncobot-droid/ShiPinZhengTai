import { Router } from "express";
import { db } from "@workspace/db";
import {
  usersTable, videosTable, userSubscriptionsTable, transactionsTable,
  topupsTable, viewsTable, categoriesTable, withdrawalsTable,
} from "@workspace/db";
import { eq, and, gte, lte, desc, sum, count, sql } from "drizzle-orm";
import { authenticate, requireRole } from "../middlewares/auth";

const router = Router();

// Enhanced overview stats
router.get("/analytics/overview", authenticate, requireRole("owner", "admin"), async (req, res) => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // User counts by role
  const [{ totalUsers }] = await db.select({ totalUsers: count() }).from(usersTable);
  const [{ premiumUsers }] = await db.select({ premiumUsers: count() }).from(userSubscriptionsTable)
    .where(and(eq(userSubscriptionsTable.isActive, true), gte(userSubscriptionsTable.endDate, now)));
  const [{ adminUsers }] = await db.select({ adminUsers: count() }).from(usersTable).where(eq(usersTable.role, "admin"));
  const [{ ownerUsers }] = await db.select({ ownerUsers: count() }).from(usersTable).where(eq(usersTable.role, "owner"));
  const [{ bannedUsers }] = await db.select({ bannedUsers: count() }).from(usersTable).where(eq(usersTable.isBanned, true));
  const [{ newUsersToday }] = await db.select({ newUsersToday: count() }).from(usersTable).where(gte(usersTable.createdAt, today));

  // Video counts
  const [{ totalVideos }] = await db.select({ totalVideos: count() }).from(videosTable);
  const [{ premiumVideos }] = await db.select({ premiumVideos: count() }).from(videosTable).where(eq(videosTable.type, "premium"));
  const [{ freeVideos }] = await db.select({ freeVideos: count() }).from(videosTable).where(eq(videosTable.type, "free"));
  const [{ newVideosToday }] = await db.select({ newVideosToday: count() }).from(videosTable).where(gte(videosTable.createdAt, today));
  const [{ totalViews }] = await db.select({ totalViews: count() }).from(viewsTable);

  // Category count
  const [{ totalCategories }] = await db.select({ totalCategories: count() }).from(categoriesTable);

  // Revenue
  const [{ revenueAllTime }] = await db.select({ revenueAllTime: sum(topupsTable.amount) }).from(topupsTable).where(eq(topupsTable.status, "confirmed"));
  const [{ revenueMonth }] = await db.select({ revenueMonth: sum(topupsTable.amount) }).from(topupsTable)
    .where(and(eq(topupsTable.status, "confirmed"), gte(topupsTable.createdAt, monthStart)));
  const [{ revenueToday }] = await db.select({ revenueToday: sum(topupsTable.amount) }).from(topupsTable)
    .where(and(eq(topupsTable.status, "confirmed"), gte(topupsTable.createdAt, today)));

  // Pending counts
  const [{ pendingTopups }] = await db.select({ pendingTopups: count() }).from(topupsTable).where(eq(topupsTable.status, "pending"));
  const [{ pendingWithdrawals }] = await db.select({ pendingWithdrawals: count() }).from(withdrawalsTable).where(eq(withdrawalsTable.status, "pending"));
  const [{ totalActiveSubscriptions }] = await db.select({ totalActiveSubscriptions: count() }).from(userSubscriptionsTable)
    .where(and(eq(userSubscriptionsTable.isActive, true), gte(userSubscriptionsTable.endDate, now)));

  res.json({
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
  });
});

// Top videos by views
router.get("/analytics/videos", authenticate, requireRole("owner", "admin"), async (req, res) => {
  const vids = await db.select().from(videosTable).orderBy(desc(videosTable.views)).limit(20);
  res.json(vids.map(v => ({
    id: v.id, title: v.title, views: v.views, likes: v.likes, type: v.type,
    thumbnail: v.thumbnail, status: v.status,
  })));
});

// Revenue chart
router.get("/analytics/revenue", authenticate, requireRole("owner", "admin"), async (req, res) => {
  const { period = "daily" } = req.query as Record<string, string>;
  const now = new Date();
  const points: { date: string; amount: number }[] = [];
  const days = period === "daily" ? 30 : period === "weekly" ? 12 : 12;

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    if (period === "daily") {
      d.setDate(d.getDate() - i);
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const end = new Date(start); end.setDate(end.getDate() + 1);
      const [{ val }] = await db.select({ val: sum(topupsTable.amount) }).from(topupsTable)
        .where(and(eq(topupsTable.status, "confirmed"), gte(topupsTable.createdAt, start), lte(topupsTable.createdAt, end)));
      points.push({ date: start.toLocaleDateString("id-ID", { day: "numeric", month: "short" }), amount: Number(val) || 0 });
    } else if (period === "weekly") {
      d.setDate(d.getDate() - i * 7);
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const end = new Date(start); end.setDate(end.getDate() + 7);
      const [{ val }] = await db.select({ val: sum(topupsTable.amount) }).from(topupsTable)
        .where(and(eq(topupsTable.status, "confirmed"), gte(topupsTable.createdAt, start), lte(topupsTable.createdAt, end)));
      points.push({ date: `Minggu ${days - i}`, amount: Number(val) || 0 });
    } else {
      d.setMonth(d.getMonth() - i);
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const [{ val }] = await db.select({ val: sum(topupsTable.amount) }).from(topupsTable)
        .where(and(eq(topupsTable.status, "confirmed"), gte(topupsTable.createdAt, start), lte(topupsTable.createdAt, end)));
      points.push({ date: start.toLocaleDateString("id-ID", { month: "short", year: "numeric" }), amount: Number(val) || 0 });
    }
  }
  res.json(points);
});

// Recent activity (latest 20 transactions)
router.get("/analytics/activity", authenticate, requireRole("owner", "admin"), async (req, res) => {
  const data = await db.select().from(transactionsTable).orderBy(desc(transactionsTable.createdAt)).limit(20);
  const enriched = await Promise.all(data.map(async (t) => {
    const [user] = await db.select({ id: usersTable.id, username: usersTable.username, avatar: usersTable.avatar })
      .from(usersTable).where(eq(usersTable.id, t.userId)).limit(1);
    return { ...t, user: user || null };
  }));
  res.json(enriched);
});

// Admin-specific stats (for their own videos)
router.get("/analytics/admin-stats", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const userId = req.user!.userId;
  const vids = await db.select().from(videosTable).where(eq(videosTable.creatorId, userId));
  const totalViews = vids.reduce((s, v) => s + v.views, 0);
  const totalLikes = vids.reduce((s, v) => s + v.likes, 0);
  res.json({ totalVideos: vids.length, totalViews, totalLikes, totalRevenue: 0 });
});

export default router;
