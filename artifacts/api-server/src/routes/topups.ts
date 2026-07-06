import { Router } from "express";
import { db } from "@workspace/db";
import { topupsTable, usersTable, transactionsTable, notificationsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { authenticate, requireRole } from "../middlewares/auth";

const router = Router();

router.get("/topups", authenticate, async (req, res) => {
  const userId = req.user!.userId;
  const { page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = parseInt(page) || 1;
  const limitNum = Math.min(parseInt(limit) || 20, 100);
  const offset = (pageNum - 1) * limitNum;

  const all = await db.select().from(topupsTable).where(eq(topupsTable.userId, userId));
  const data = await db
    .select()
    .from(topupsTable)
    .where(eq(topupsTable.userId, userId))
    .orderBy(desc(topupsTable.createdAt))
    .limit(limitNum)
    .offset(offset);
  res.json({ data, total: all.length, page: pageNum, limit: limitNum });
});

router.post("/topups", authenticate, async (req, res) => {
  const userId = req.user!.userId;
  const { amount, paymentProof } = req.body;
  if (!amount || amount <= 0) { res.status(400).json({ error: "Invalid amount" }); return; }
  const [topup] = await db.insert(topupsTable).values({ userId, amount, paymentProof, status: "pending" }).returning();
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  res.status(201).json({ ...topup, user });
});

router.get("/topups/all", authenticate, requireRole("owner"), async (req, res) => {
  const { status, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = parseInt(page) || 1;
  const limitNum = Math.min(parseInt(limit) || 20, 100);
  const offset = (pageNum - 1) * limitNum;

  const whereClause = status ? eq(topupsTable.status, status as any) : undefined;
  const all = whereClause
    ? await db.select().from(topupsTable).where(whereClause)
    : await db.select().from(topupsTable);
  const rawData = whereClause
    ? await db.select().from(topupsTable).where(whereClause).orderBy(desc(topupsTable.createdAt)).limit(limitNum).offset(offset)
    : await db.select().from(topupsTable).orderBy(desc(topupsTable.createdAt)).limit(limitNum).offset(offset);

  const data = await Promise.all(rawData.map(async (t) => {
    const [user] = await db.select({ id: usersTable.id, username: usersTable.username, email: usersTable.email, role: usersTable.role, avatar: usersTable.avatar, isBanned: usersTable.isBanned, walletBalance: usersTable.walletBalance, totalTopup: usersTable.totalTopup, totalSpent: usersTable.totalSpent, createdAt: usersTable.createdAt }).from(usersTable).where(eq(usersTable.id, t.userId)).limit(1);
    return { ...t, user };
  }));
  res.json({ data, total: all.length, page: pageNum, limit: limitNum });
});

router.patch("/topups/:id/confirm", authenticate, requireRole("owner"), async (req, res) => {
  const id = parseInt(req.params.id);
  const [topup] = await db.select().from(topupsTable).where(eq(topupsTable.id, id)).limit(1);
  if (!topup) { res.status(404).json({ error: "Not found" }); return; }
  if (topup.status !== "pending") { res.status(400).json({ error: "Already processed" }); return; }
  // Update topup status
  const [updated] = await db.update(topupsTable).set({ status: "confirmed", updatedAt: new Date() }).where(eq(topupsTable.id, id)).returning();
  // Credit user wallet
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, topup.userId)).limit(1);
  if (user) {
    await db.update(usersTable).set({
      walletBalance: user.walletBalance + topup.amount,
      totalTopup: user.totalTopup + topup.amount,
      updatedAt: new Date(),
    }).where(eq(usersTable.id, topup.userId));
    await db.insert(transactionsTable).values({
      userId: topup.userId, type: "topup", amount: topup.amount,
      description: `Top up confirmed - Rp ${topup.amount.toLocaleString()}`,
      referenceId: topup.id,
    });
    await db.insert(notificationsTable).values({
      userId: topup.userId, title: "Top Up Confirmed",
      message: `Your top up of Rp ${topup.amount.toLocaleString()} has been confirmed.`,
      type: "topup",
    });
  }
  res.json(updated);
});

router.patch("/topups/:id/deny", authenticate, requireRole("owner"), async (req, res) => {
  const id = parseInt(req.params.id);
  const [topup] = await db.select().from(topupsTable).where(eq(topupsTable.id, id)).limit(1);
  if (!topup) { res.status(404).json({ error: "Not found" }); return; }
  const [updated] = await db.update(topupsTable).set({ status: "denied", updatedAt: new Date() }).where(eq(topupsTable.id, id)).returning();
  await db.insert(notificationsTable).values({
    userId: topup.userId, title: "Top Up Denied",
    message: `Your top up of Rp ${topup.amount.toLocaleString()} was denied. Please contact support.`,
    type: "topup",
  });
  res.json(updated);
});

router.delete("/topups/:id", authenticate, requireRole("owner"), async (req, res) => {
  const id = parseInt(req.params.id);
  await db.delete(topupsTable).where(eq(topupsTable.id, id));
  res.json({ message: "Deleted" });
});

export default router;
