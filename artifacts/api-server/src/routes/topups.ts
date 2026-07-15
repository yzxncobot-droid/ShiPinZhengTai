import { Router } from "express";
import { db } from "@workspace/db";
import {
  topupsTable, usersTable, transactionsTable, notificationsTable,
  walletsTable, walletTransactionsTable, paymentProofsTable,
} from "@workspace/db";
import { eq, desc, and, count, sql, gte } from "drizzle-orm";
import { authenticate, requireRole } from "../middlewares/auth";
import { logger } from "../lib/logger";

const router = Router();

// ── GET /topups — current user's own top-up history ───────────────────────────
router.get("/topups", authenticate, async (req, res) => {
  const userId = req.user!.userId;
  const { page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = parseInt(page) || 1;
  const limitNum = Math.min(parseInt(limit) || 20, 100);
  const offset = (pageNum - 1) * limitNum;

  const [countRow] = await db
    .select({ total: count() })
    .from(topupsTable)
    .where(eq(topupsTable.userId, userId));

  const data = await db
    .select()
    .from(topupsTable)
    .where(eq(topupsTable.userId, userId))
    .orderBy(desc(topupsTable.createdAt))
    .limit(limitNum)
    .offset(offset);

  res.json({ data, total: Number(countRow?.total ?? 0), page: pageNum, limit: limitNum });
});

// ── POST /topups — submit a new top-up / payment request ─────────────────────
router.post("/topups", authenticate, async (req, res) => {
  const userId = req.user!.userId;
  const { amount, paymentProof, paymentProofId } = req.body;

  if (!amount || Number(amount) < 1000) {
    res.status(400).json({ error: "Minimum top-up adalah Rp 1.000" }); return;
  }

  // If a proofId was provided, validate it belongs to this user
  if (paymentProofId) {
    const [proof] = await db.select({ id: paymentProofsTable.id, userId: paymentProofsTable.userId })
      .from(paymentProofsTable).where(eq(paymentProofsTable.id, paymentProofId)).limit(1);
    if (!proof || proof.userId !== userId) {
      res.status(400).json({ error: "Invalid payment proof reference" }); return;
    }
  }

  const [topup] = await db.insert(topupsTable).values({
    userId,
    amount: Number(amount),
    paymentProof: paymentProof ?? null,
    paymentProofId: paymentProofId ?? null,
    status: "pending",
  }).returning();

  const [user] = await db.select({
    id: usersTable.id, username: usersTable.username, email: usersTable.email,
    role: usersTable.role, avatar: usersTable.avatar,
  }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);

  res.status(201).json({ ...topup, user });
});

// ── GET /topups/all — admin/owner: all top-ups ────────────────────────────────
router.get("/topups/all", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const { status, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = parseInt(page) || 1;
  const limitNum = Math.min(parseInt(limit) || 20, 100);
  const offset = (pageNum - 1) * limitNum;

  const where = status ? eq(topupsTable.status, status as any) : undefined;

  const [countRow] = await db.select({ total: count() }).from(topupsTable).where(where);
  const total = Number(countRow?.total ?? 0);

  const rawData = await db
    .select()
    .from(topupsTable)
    .where(where)
    .orderBy(desc(topupsTable.createdAt))
    .limit(limitNum)
    .offset(offset);

  const data = await Promise.all(rawData.map(async (t) => {
    const [user] = await db.select({
      id: usersTable.id, username: usersTable.username, email: usersTable.email,
      role: usersTable.role, avatar: usersTable.avatar, isBanned: usersTable.isBanned,
      walletBalance: usersTable.walletBalance, totalTopup: usersTable.totalTopup,
      totalSpent: usersTable.totalSpent, createdAt: usersTable.createdAt,
    }).from(usersTable).where(eq(usersTable.id, t.userId)).limit(1);

    let proof = null;
    if (t.paymentProofId) {
      const [p] = await db.select().from(paymentProofsTable)
        .where(eq(paymentProofsTable.id, t.paymentProofId)).limit(1);
      proof = p ?? null;
    }

    return { ...t, user, proof };
  }));

  res.json({ data, total, page: pageNum, limit: limitNum });
});

// ── PATCH /topups/:id/confirm — approve top-up (admin/owner) ─────────────────
router.patch("/topups/:id/confirm", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const id = parseInt(req.params.id);
  const reviewerId = req.user!.userId;
  const { note } = req.body;

  const [topup] = await db.select().from(topupsTable).where(eq(topupsTable.id, id)).limit(1);
  if (!topup) { res.status(404).json({ error: "Not found" }); return; }
  if (topup.status !== "pending") { res.status(400).json({ error: "Already processed" }); return; }

  const [updated] = await db.update(topupsTable)
    .set({
      status: "confirmed",
      reviewedBy: reviewerId,
      reviewedAt: new Date(),
      reviewNote: note ?? null,
      updatedAt: new Date(),
    })
    .where(eq(topupsTable.id, id))
    .returning();

  // Credit user wallet
  const [user] = await db.select().from(usersTable)
    .where(eq(usersTable.id, topup.userId)).limit(1);

  if (user) {
    const newBalance = user.walletBalance + topup.amount;

    await db.update(usersTable).set({
      walletBalance: newBalance,
      totalTopup: user.totalTopup + topup.amount,
      updatedAt: new Date(),
    }).where(eq(usersTable.id, topup.userId));

    // Sync wallet ledger row
    await db.insert(walletsTable)
      .values({ userId: topup.userId, balance: newBalance, totalEarned: user.totalTopup + topup.amount, totalSpent: user.totalSpent })
      .onConflictDoNothing();
    await db.update(walletsTable).set({
      balance: newBalance,
      totalEarned: user.totalTopup + topup.amount,
      lastTransactionAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(walletsTable.userId, topup.userId));

    // Transactions ledger
    await db.insert(transactionsTable).values({
      userId: topup.userId,
      type: "topup",
      amount: topup.amount,
      description: `Top up confirmed — Rp ${topup.amount.toLocaleString("id-ID")}`,
      referenceId: topup.id,
    });

    await db.insert(walletTransactionsTable).values({
      userId: topup.userId,
      type: "topup",
      amount: topup.amount,
      balanceAfter: newBalance,
      description: `Top up confirmed`,
      referenceType: "topup",
      referenceId: topup.id,
      createdBy: reviewerId,
    });

    await db.insert(notificationsTable).values({
      userId: topup.userId,
      title: "Top Up Dikonfirmasi ✓",
      message: `Top up sebesar Rp ${topup.amount.toLocaleString("id-ID")} telah dikonfirmasi. Saldo kamu bertambah!`,
      type: "topup",
    });

    // Mark proof as approved too
    if (topup.paymentProofId) {
      await db.update(paymentProofsTable).set({
        status: "approved", reviewedBy: reviewerId, reviewedAt: new Date(), reviewNote: note ?? null, updatedAt: new Date(),
      }).where(eq(paymentProofsTable.id, topup.paymentProofId));
    }
  }

  logger.info({ topupId: id, userId: topup.userId, amount: topup.amount, by: reviewerId }, "Topup confirmed");
  res.json(updated);
});

// ── PATCH /topups/:id/deny — deny top-up (admin/owner) ───────────────────────
router.patch("/topups/:id/deny", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const id = parseInt(req.params.id);
  const reviewerId = req.user!.userId;
  const { note } = req.body;

  const [topup] = await db.select().from(topupsTable).where(eq(topupsTable.id, id)).limit(1);
  if (!topup) { res.status(404).json({ error: "Not found" }); return; }
  if (topup.status !== "pending") { res.status(400).json({ error: "Already processed" }); return; }

  const [updated] = await db.update(topupsTable)
    .set({
      status: "denied",
      reviewedBy: reviewerId,
      reviewedAt: new Date(),
      reviewNote: note ?? null,
      updatedAt: new Date(),
    })
    .where(eq(topupsTable.id, id))
    .returning();

  await db.insert(notificationsTable).values({
    userId: topup.userId,
    title: "Top Up Ditolak",
    message: `Top up sebesar Rp ${topup.amount.toLocaleString("id-ID")} ditolak.${note ? ` Alasan: ${note}` : " Hubungi admin untuk informasi lebih lanjut."}`,
    type: "topup",
  });

  if (topup.paymentProofId) {
    await db.update(paymentProofsTable).set({
      status: "denied", reviewedBy: reviewerId, reviewedAt: new Date(), reviewNote: note ?? null, updatedAt: new Date(),
    }).where(eq(paymentProofsTable.id, topup.paymentProofId));
  }

  logger.info({ topupId: id, userId: topup.userId, amount: topup.amount, by: reviewerId }, "Topup denied");
  res.json(updated);
});

// ── DELETE /topups/:id (admin/owner) ─────────────────────────────────────────
router.delete("/topups/:id", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const id = parseInt(req.params.id);
  await db.delete(topupsTable).where(eq(topupsTable.id, id));
  res.json({ message: "Deleted" });
});

export default router;
