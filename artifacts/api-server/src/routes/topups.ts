import { Router } from "express";
import { db } from "@workspace/db";
import {
  topupsTable, usersTable, walletsTable, walletTransactionsTable,
  transactionsTable, notificationsTable, paymentProofsTable,
} from "@workspace/db";
import { eq, and, desc, sql, count } from "drizzle-orm";
import { authenticate, requireRole } from "../middlewares/auth";
import { invalidateUserCache, invalidateCache, keys } from "../lib/redis";
import { logger } from "../lib/logger";

const router = Router();

// ── GET /topups — user's own top-up history ────────────────────────────────────
router.get("/topups", authenticate, async (req, res) => {
  const userId = req.user!.userId;
  const { page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = parseInt(page) || 1;
  const limitNum = Math.min(parseInt(limit) || 20, 100);
  const offset = (pageNum - 1) * limitNum;

  const [{ total }] = await db.select({ total: count() }).from(topupsTable).where(eq(topupsTable.userId, userId));
  const data = await db.select().from(topupsTable)
    .where(eq(topupsTable.userId, userId))
    .orderBy(desc(topupsTable.createdAt))
    .limit(limitNum)
    .offset(offset);

  res.json({ data, total: Number(total), page: pageNum, limit: limitNum });
});

// ── POST /topups — submit a top-up request ────────────────────────────────────
router.post("/topups", authenticate, async (req, res) => {
  const userId = req.user!.userId;
  const { amount, paymentProof, paymentProofId, transferAmount } = req.body;

  if (!amount || amount <= 0) {
    res.status(400).json({ error: "Invalid amount" }); return;
  }

  // Compute match status: compare selected amount vs what user claims to have transferred
  const parsedTransfer = transferAmount != null ? Number(transferAmount) : null;
  const amountMatchStatus =
    parsedTransfer != null && parsedTransfer !== Number(amount) ? "mismatch" : "match";

  const [topup] = await db.insert(topupsTable).values({
    userId, amount, paymentProof, paymentProofId: paymentProofId ?? null,
    transferAmount: parsedTransfer,
    amountMatchStatus,
  }).returning();

  res.status(201).json(topup);
});

// ── GET /topups/all — list all top-ups (admin/owner) ─────────────────────────
router.get("/topups/all", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const { status, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = parseInt(page) || 1;
  const limitNum = Math.min(parseInt(limit) || 20, 100);
  const offset = (pageNum - 1) * limitNum;

  const where = status ? eq(topupsTable.status, status as any) : undefined;
  const [{ total }] = await db.select({ total: count() }).from(topupsTable).where(where);

  const raw = await db.select().from(topupsTable)
    .where(where)
    .orderBy(desc(topupsTable.createdAt))
    .limit(limitNum)
    .offset(offset);

  const data = await Promise.all(raw.map(async (t: any) => {
    const [user] = await db.select({
      id: usersTable.id, username: usersTable.username, avatar: usersTable.avatar,
    }).from(usersTable).where(eq(usersTable.id, t.userId)).limit(1);
    return { ...t, user: user ?? null };
  }));

  res.json({ data, total: Number(total), page: pageNum, limit: limitNum });
});

// ── PATCH /topups/:id/confirm — approve top-up (admin/owner) ─────────────────
router.patch("/topups/:id/confirm", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const id = req.params.id as string;
  const reviewerId = req.user!.userId;

  try {
    const [topup] = await db.select().from(topupsTable).where(eq(topupsTable.id, id)).limit(1);
    if (!topup) { res.status(404).json({ error: "Top-up not found" }); return; }
    if (topup.status !== "pending") {
      res.status(400).json({ error: `Cannot confirm: top-up is already "${topup.status}"` }); return;
    }
    if (topup.amountMatchStatus === "mismatch") {
      res.status(400).json({ error: "Cannot confirm: transfer amount does not match selected amount. Please deny this payment." });
      return;
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, topup.userId)).limit(1);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    const newBalance = user.walletBalance + topup.amount;
    const amountFormatted = topup.amount.toLocaleString("id-ID");

    logger.info({ topupId: id, userId: topup.userId, amount: topup.amount, by: reviewerId }, "Topup confirm: starting transaction");

    await db.transaction(async (tx: any) => {
      // Step 1: update user balance cache
      await tx.update(usersTable).set({
        walletBalance: newBalance,
        totalTopup: sql`${usersTable.totalTopup} + ${topup.amount}`,
        updatedAt: new Date(),
      }).where(eq(usersTable.id, topup.userId));
      logger.info({ topupId: id }, "Topup confirm: user balance updated");

      // Step 2: update wallet ledger
      await tx.update(walletsTable).set({
        balance: newBalance,
        totalEarned: sql`${walletsTable.totalEarned} + ${topup.amount}`,
        updatedAt: new Date(),
        lastTransactionAt: new Date(),
      }).where(eq(walletsTable.userId, topup.userId));
      logger.info({ topupId: id }, "Topup confirm: wallet updated");

      // Step 3: mark topup confirmed
      await tx.update(topupsTable).set({
        status: "confirmed",
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(topupsTable.id, id));
      logger.info({ topupId: id }, "Topup confirm: topup status set to confirmed");

      // Step 4: append to transactions history
      await tx.insert(transactionsTable).values({
        userId: topup.userId,
        type: "topup",
        amount: topup.amount,
        description: `Top up confirmed: Rp ${amountFormatted}`,
        referenceId: topup.id,
      });
      logger.info({ topupId: id }, "Topup confirm: transaction record inserted");

      // Step 5: append to wallet transactions ledger
      await tx.insert(walletTransactionsTable).values({
        userId: topup.userId,
        type: "topup",
        amount: topup.amount,
        balanceAfter: newBalance,
        description: `Top up confirmed: Rp ${amountFormatted}`,
        referenceType: "topup",
        referenceId: topup.id,
        createdBy: reviewerId,
      });
      logger.info({ topupId: id }, "Topup confirm: wallet transaction record inserted");

      // Step 6: send notification to user
      await tx.insert(notificationsTable).values({
        userId: topup.userId,
        title: "Top Up Berhasil",
        message: `Top up sebesar Rp ${amountFormatted} berhasil dikonfirmasi. Saldo kamu sekarang Rp ${newBalance.toLocaleString("id-ID")}.`,
        type: "success",
        category: "payment",
        referenceType: "topup",
        referenceId: topup.id,
      });
      logger.info({ topupId: id }, "Topup confirm: notification sent");

      // Step 7: update payment proof status if present
      if (topup.paymentProofId) {
        await tx.update(paymentProofsTable).set({
          status: "approved", reviewedBy: reviewerId, reviewedAt: new Date(), updatedAt: new Date(),
        }).where(eq(paymentProofsTable.id, topup.paymentProofId));
        logger.info({ topupId: id, proofId: topup.paymentProofId }, "Topup confirm: payment proof approved");
      }
    });

    await invalidateUserCache(topup.userId);
    await invalidateCache(keys.analytics("overview")).catch(() => {});

    const [updated] = await db.select().from(topupsTable).where(eq(topupsTable.id, id)).limit(1);
    logger.info({ topupId: id, userId: topup.userId, amount: topup.amount, by: reviewerId }, "Topup confirmed successfully");
    res.json(updated);
  } catch (err: any) {
    logger.error({ err: err?.message, stack: err?.stack, id }, "Topup confirm failed");
    const detail = err?.message ?? "Unknown error";
    res.status(500).json({ error: `Failed to confirm top-up: ${detail}` });
  }
});

// ── PATCH /topups/:id/deny — deny top-up (admin/owner) ───────────────────────
router.patch("/topups/:id/deny", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const id = req.params.id as string;
  const reviewerId = req.user!.userId;
  const { note } = req.body;

  try {
    const [topup] = await db.select().from(topupsTable).where(eq(topupsTable.id, id)).limit(1);
    if (!topup) { res.status(404).json({ error: "Top-up not found" }); return; }
    if (topup.status !== "pending") {
      res.status(400).json({ error: `Cannot deny: top-up is already "${topup.status}"` }); return;
    }

    const amountFormatted = topup.amount.toLocaleString("id-ID");
    logger.info({ topupId: id, userId: topup.userId, amount: topup.amount, by: reviewerId }, "Topup deny: starting transaction");

    let updated: typeof topup;
    await db.transaction(async (tx: any) => {
      // Step 1: mark topup denied
      const [result] = await tx.update(topupsTable)
        .set({
          status: "denied",
          reviewedBy: reviewerId,
          reviewedAt: new Date(),
          reviewNote: note ?? null,
          updatedAt: new Date(),
        })
        .where(eq(topupsTable.id, id))
        .returning();
      updated = result;
      logger.info({ topupId: id }, "Topup deny: status set to denied");

      // Step 2: send rejection notification
      await tx.insert(notificationsTable).values({
        userId: topup.userId,
        title: "Top Up Ditolak",
        message: `Top up sebesar Rp ${amountFormatted} ditolak.${note ? ` Alasan: ${note}` : " Hubungi admin untuk informasi lebih lanjut."}`,
        type: "warning",
        category: "payment",
        referenceType: "topup",
        referenceId: topup.id,
      });
      logger.info({ topupId: id }, "Topup deny: notification sent");

      // Step 3: update payment proof status if present
      if (topup.paymentProofId) {
        await tx.update(paymentProofsTable).set({
          status: "denied", reviewedBy: reviewerId, reviewedAt: new Date(), reviewNote: note ?? null, updatedAt: new Date(),
        }).where(eq(paymentProofsTable.id, topup.paymentProofId));
        logger.info({ topupId: id, proofId: topup.paymentProofId }, "Topup deny: payment proof denied");
      }
    });

    logger.info({ topupId: id, userId: topup.userId, amount: topup.amount, by: reviewerId }, "Topup denied successfully");
    res.json(updated!);
  } catch (err: any) {
    logger.error({ err: err?.message, stack: err?.stack, id }, "Topup deny failed");
    const detail = err?.message ?? "Unknown error";
    res.status(500).json({ error: `Failed to deny top-up: ${detail}` });
  }
});

// ── DELETE /topups/:id (admin/owner) ─────────────────────────────────────────
router.delete("/topups/:id", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const id = req.params.id as string;
  await db.delete(topupsTable).where(eq(topupsTable.id, id));
  res.json({ message: "Deleted" });
});

export default router;
