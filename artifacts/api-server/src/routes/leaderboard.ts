import { Router } from "express";
import { db } from "@workspace/db";
import { topupsTable, usersTable, creatorVerificationsTable, verificationHistoryTable } from "@workspace/db";
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
      .groupBy(topupsTable.userId, usersTable.username, usersTable.avatar)
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

    // Update Sulthan badge when computing the alltime leaderboard
    if (period === "alltime" && mapped.length > 0) {
      updateSulthanBadge(mapped[0].userId, mapped[0].username).catch(() => {});
    }

    return mapped;
  });

  res.json(data);
});

/** Atomically transfer the 👑 Sulthan badge to the new all-time rank-#1 user. */
async function updateSulthanBadge(newTopUserId: string, newTopUsername: string) {
  // Find current sulthan holder
  const [current] = await db
    .select({ id: creatorVerificationsTable.id, userId: creatorVerificationsTable.userId })
    .from(creatorVerificationsTable)
    .where(and(
      eq(creatorVerificationsTable.badgeType, "sulthan"),
      eq(creatorVerificationsTable.status, "active"),
    ));

  if (current?.userId === newTopUserId) return; // no change

  // Revoke from previous holder
  if (current) {
    await db.update(creatorVerificationsTable)
      .set({ status: "revoked", revokedAt: new Date() })
      .where(eq(creatorVerificationsTable.id, current.id));

    // Determine best remaining badge for old holder
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

  // Grant to new #1
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
