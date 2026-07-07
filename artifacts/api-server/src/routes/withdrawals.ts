import { Router } from "express";
import { db } from "@workspace/db";
import { withdrawalsTable, usersTable, transactionsTable, notificationsTable, auditLogsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { authenticate, requireRole } from "../middlewares/auth";

const router = Router();

// User: create withdrawal request
router.post("/withdrawals", authenticate, async (req, res) => {
  const userId = req.user!.userId;
  const { amount, method = "bank", accountName, accountNumber, bankName, notes } = req.body;

  if (!amount || amount <= 0) {
    res.status(400).json({ error: "Invalid amount" }); return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  if (user.walletBalance < amount) {
    res.status(400).json({ error: "Insufficient wallet balance" }); return;
  }

  const [withdrawal] = await db.insert(withdrawalsTable).values({
    userId, amount, method, accountName, accountNumber, bankName, notes,
  }).returning();

  await db.insert(auditLogsTable).values({
    userId, action: "create_withdrawal", entity: "withdrawal", entityId: String(withdrawal.id),
    details: JSON.stringify({ amount, method }),
    ipAddress: req.ip,
  });

  res.status(201).json(withdrawal);
});

// User: list own withdrawals
router.get("/withdrawals/my", authenticate, async (req, res) => {
  const userId = req.user!.userId;
  const { page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = parseInt(page) || 1;
  const limitNum = Math.min(parseInt(limit) || 20, 100);
  const offset = (pageNum - 1) * limitNum;

  const all = await db.select().from(withdrawalsTable).where(eq(withdrawalsTable.userId, userId));
  const data = await db.select().from(withdrawalsTable)
    .where(eq(withdrawalsTable.userId, userId))
    .orderBy(desc(withdrawalsTable.createdAt))
    .limit(limitNum).offset(offset);

  res.json({ data, total: all.length, page: pageNum, limit: limitNum });
});

// Owner/Admin: list all withdrawals
router.get("/withdrawals", authenticate, requireRole("owner", "admin"), async (req, res) => {
  const { status, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = parseInt(page) || 1;
  const limitNum = Math.min(parseInt(limit) || 20, 100);
  const offset = (pageNum - 1) * limitNum;

  const where = status ? eq(withdrawalsTable.status, status as any) : undefined;
  const all = where
    ? await db.select().from(withdrawalsTable).where(where)
    : await db.select().from(withdrawalsTable);
  const raw = where
    ? await db.select().from(withdrawalsTable).where(where).orderBy(desc(withdrawalsTable.createdAt)).limit(limitNum).offset(offset)
    : await db.select().from(withdrawalsTable).orderBy(desc(withdrawalsTable.createdAt)).limit(limitNum).offset(offset);

  const data = await Promise.all(raw.map(async (w) => {
    const [user] = await db.select({
      id: usersTable.id, username: usersTable.username, email: usersTable.email,
      avatar: usersTable.avatar, walletBalance: usersTable.walletBalance,
    }).from(usersTable).where(eq(usersTable.id, w.userId)).limit(1);
    return { ...w, user: user || null };
  }));

  res.json({ data, total: all.length, page: pageNum, limit: limitNum });
});

// Owner: approve withdrawal
router.patch("/withdrawals/:id/approve", authenticate, requireRole("owner"), async (req, res) => {
  const id = parseInt(req.params.id);
  const adminId = req.user!.userId;

  const [withdrawal] = await db.select().from(withdrawalsTable).where(eq(withdrawalsTable.id, id)).limit(1);
  if (!withdrawal) { res.status(404).json({ error: "Not found" }); return; }
  if (withdrawal.status !== "pending") { res.status(400).json({ error: "Already processed" }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, withdrawal.userId)).limit(1);
  if (!user || user.walletBalance < withdrawal.amount) {
    res.status(400).json({ error: "Insufficient balance" }); return;
  }

  // Deduct balance
  await db.update(usersTable).set({
    walletBalance: user.walletBalance - withdrawal.amount,
    totalSpent: user.totalSpent + withdrawal.amount,
    updatedAt: new Date(),
  }).where(eq(usersTable.id, withdrawal.userId));

  const [updated] = await db.update(withdrawalsTable).set({
    status: "approved", processedBy: adminId, processedAt: new Date(), updatedAt: new Date(),
  }).where(eq(withdrawalsTable.id, id)).returning();

  await db.insert(transactionsTable).values({
    userId: withdrawal.userId, type: "withdrawal", amount: -withdrawal.amount,
    description: `Withdrawal approved - Rp ${withdrawal.amount.toLocaleString()}`,
    referenceId: withdrawal.id,
  });

  await db.insert(notificationsTable).values({
    userId: withdrawal.userId, title: "Withdrawal Approved",
    message: `Your withdrawal of Rp ${withdrawal.amount.toLocaleString()} has been approved.`,
    type: "system",
  });

  await db.insert(auditLogsTable).values({
    userId: adminId, action: "approve_withdrawal", entity: "withdrawal", entityId: String(id),
    details: JSON.stringify({ amount: withdrawal.amount }), ipAddress: req.ip,
  });

  res.json(updated);
});

// Owner: reject withdrawal
router.patch("/withdrawals/:id/reject", authenticate, requireRole("owner"), async (req, res) => {
  const id = parseInt(req.params.id);
  const adminId = req.user!.userId;
  const { reason } = req.body;

  const [withdrawal] = await db.select().from(withdrawalsTable).where(eq(withdrawalsTable.id, id)).limit(1);
  if (!withdrawal) { res.status(404).json({ error: "Not found" }); return; }

  const [updated] = await db.update(withdrawalsTable).set({
    status: "rejected", processedBy: adminId, processedAt: new Date(),
    notes: reason || withdrawal.notes, updatedAt: new Date(),
  }).where(eq(withdrawalsTable.id, id)).returning();

  await db.insert(notificationsTable).values({
    userId: withdrawal.userId, title: "Withdrawal Rejected",
    message: `Your withdrawal of Rp ${withdrawal.amount.toLocaleString()} was rejected.${reason ? ` Reason: ${reason}` : ""}`,
    type: "system",
  });

  await db.insert(auditLogsTable).values({
    userId: adminId, action: "reject_withdrawal", entity: "withdrawal", entityId: String(id),
    details: JSON.stringify({ amount: withdrawal.amount, reason }), ipAddress: req.ip,
  });

  res.json(updated);
});

export default router;
