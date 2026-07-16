import { Router } from "express";
import { db } from "@workspace/db";
import { topupsTable, usersTable } from "@workspace/db";
import { eq, and, gte, desc, sum } from "drizzle-orm";
import { getOrSet, keys, TTL } from "../lib/redis";

const router = Router();

router.get("/leaderboard/topup", async (req, res) => {
  const { period = "alltime" } = req.query as Record<string, string>;
  const cacheKey = keys.leaderboard(period);

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
      })
      .from(topupsTable)
      .innerJoin(usersTable, eq(topupsTable.userId, usersTable.id))
      .where(
        since
          ? and(eq(topupsTable.status, "confirmed"), gte(topupsTable.createdAt, since))
          : eq(topupsTable.status, "confirmed"),
      )
      .groupBy(topupsTable.userId, usersTable.username, usersTable.avatar)
      .orderBy(desc(sum(topupsTable.amount)))
      .limit(50);

    return rows.map((r, i) => ({
      rank: i + 1,
      userId: r.userId,
      username: r.username,
      avatar: r.avatar,
      totalAmount: Number(r.totalAmount) || 0,
    }));
  });

  res.json(data);
});

export default router;
