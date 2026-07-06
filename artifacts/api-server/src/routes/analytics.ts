import { Router } from "express";
import { db } from "@workspace/db";
import {
  usersTable, videosTable, userSubscriptionsTable, transactionsTable,
  topupsTable, viewsTable,
} from "@workspace/db";
import { eq, and, gte, desc, sum, count } from "drizzle-orm";
import { authenticate, requireRole } from "../middlewares/auth";

const router = Router();

router.get("/analytics/overview", authenticate, requireRole("owner", "admin"), async (req, res) => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [{ totalUsers }] = await db.select({ totalUsers: count() }).from(usersTable);
  const [{ totalVideos }] = await db.select({ totalVideos: count() }).from(videosTable);
  const [{ totalActiveSubscriptions }] = await db
    .select({ totalActiveSubscriptions: count() })
    .from(userSubscriptionsTable)
    .where(and(eq(userSubscriptionsTable.isActive, true), gte(userSubscriptionsTable.endDate, now)));
  const [{ totalRevenue }] = await db
    .select({ totalRevenue: sum(topupsTable.amount) })
    .from(topupsTable)
    .where(eq(topupsTable.status, "confirmed"));
  const [{ totalViews }] = await db.select({ totalViews: count() }).from(viewsTable);
  const [{ totalTopupAmount }] = await db
    .select({ totalTopupAmount: sum(topupsTable.amount) })
    .from(topupsTable)
    .where(eq(topupsTable.status, "confirmed"));
  const [{ newUsersToday }] = await db
    .select({ newUsersToday: count() })
    .from(usersTable)
    .where(gte(usersTable.createdAt, today));
  const [{ newVideosToday }] = await db
    .select({ newVideosToday: count() })
    .from(videosTable)
    .where(gte(videosTable.createdAt, today));

  res.json({
    totalUsers: Number(totalUsers) || 0,
    totalVideos: Number(totalVideos) || 0,
    totalActiveSubscriptions: Number(totalActiveSubscriptions) || 0,
    totalRevenue: Number(totalRevenue) || 0,
    totalViews: Number(totalViews) || 0,
    totalTopupAmount: Number(totalTopupAmount) || 0,
    newUsersToday: Number(newUsersToday) || 0,
    newVideosToday: Number(newVideosToday) || 0,
  });
});

router.get("/analytics/videos", authenticate, requireRole("owner", "admin"), async (req, res) => {
  const vids = await db.select().from(videosTable).orderBy(desc(videosTable.views)).limit(20);
  res.json(vids.map(v => ({
    id: v.id,
    title: v.title,
    views: v.views,
    likes: v.likes,
    type: v.type,
    revenue: 0,
  })));
});

router.get("/analytics/revenue", authenticate, requireRole("owner"), async (req, res) => {
  const { period = "daily" } = req.query as Record<string, string>;
  const now = new Date();
  const points: { date: string; amount: number }[] = [];
  const days = period === "daily" ? 7 : period === "weekly" ? 12 : 6;
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    if (period === "daily") {
      d.setDate(d.getDate() - i);
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      const [{ val }] = await db.select({ val: sum(topupsTable.amount) }).from(topupsTable).where(and(eq(topupsTable.status, "confirmed"), gte(topupsTable.createdAt, start)));
      points.push({ date: start.toISOString().slice(0, 10), amount: Number(val) || 0 });
    } else if (period === "weekly") {
      d.setDate(d.getDate() - i * 7);
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const [{ val }] = await db.select({ val: sum(topupsTable.amount) }).from(topupsTable).where(and(eq(topupsTable.status, "confirmed"), gte(topupsTable.createdAt, start)));
      points.push({ date: `Week ${days - i}`, amount: Number(val) || 0 });
    } else {
      d.setMonth(d.getMonth() - i);
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const [{ val }] = await db.select({ val: sum(topupsTable.amount) }).from(topupsTable).where(and(eq(topupsTable.status, "confirmed"), gte(topupsTable.createdAt, start)));
      points.push({ date: start.toISOString().slice(0, 7), amount: Number(val) || 0 });
    }
  }
  res.json(points);
});

router.get("/analytics/admin-stats", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const userId = req.user!.userId;
  const vids = await db.select().from(videosTable).where(eq(videosTable.creatorId, userId));
  const totalViews = vids.reduce((s, v) => s + v.views, 0);
  const totalLikes = vids.reduce((s, v) => s + v.likes, 0);
  res.json({
    totalVideos: vids.length,
    totalViews,
    totalLikes,
    totalRevenue: 0,
  });
});

export default router;
