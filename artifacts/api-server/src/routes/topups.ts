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
import {
  createDynamicQris, fetchQrisMutations, gatewayErrorCode, getGatewayState,
} from "../lib/jagopay";

const router = Router();

const MIN_TOPUP = 100;
const MAX_TOPUP = 1_000_000;
const PRESET_TOPUPS = new Set([1_000, 5_000, 10_000, 15_000, 25_000, 50_000]);

function parseTopupAmount(value: unknown): number | null {
  const amount = Number(value);
  if (!Number.isInteger(amount) || amount < MIN_TOPUP || amount > MAX_TOPUP) return null;
  return amount;
}

function isPaidStatus(status: string): boolean {
  return status === "paid" || status === "confirmed";
}

/**
 * Credit a verified gateway mutation exactly once. The topup row and user row
 * are locked inside one DB transaction so repeated polling cannot double-credit.
 */
async function creditVerifiedTopup(
  topupId: string,
  gatewayReference: string,
): Promise<{ status: string; newBalance?: number }> {
  return db.transaction(async (tx: any) => {
    const lockedResult = await tx.execute(sql`
      SELECT id, user_id, amount, status
      FROM topups
      WHERE id = ${topupId}::uuid
      FOR UPDATE
    `);
    const topup = lockedResult.rows[0] as any;
    if (!topup) return { status: "not_found" };
    if (isPaidStatus(String(topup.status))) return { status: "paid" };
    if (String(topup.status) !== "pending") return { status: String(topup.status) };

    const duplicate = await tx.select({ id: walletTransactionsTable.id })
      .from(walletTransactionsTable)
      .where(and(
        eq(walletTransactionsTable.referenceType, "topup"),
        eq(walletTransactionsTable.referenceId, gatewayReference),
      ))
      .limit(1);
    if (duplicate.length > 0) {
      // The mutation was already assigned to another top-up. Never mark a
      // second pending transaction paid just because it has the same amount.
      return { status: "already_processed" };
    }

    const userResult = await tx.execute(sql`
      SELECT id, wallet_balance, total_topup
      FROM users
      WHERE id = ${topup.user_id}::uuid
      FOR UPDATE
    `);
    const user = userResult.rows[0] as any;
    if (!user) return { status: "user_not_found" };

    const before = Number(user.wallet_balance ?? 0);
    const amount = Number(topup.amount);
    const after = before + amount;

    await tx.update(usersTable).set({
      walletBalance: after,
      totalTopup: sql`${usersTable.totalTopup} + ${amount}`,
      updatedAt: new Date(),
    }).where(eq(usersTable.id, topup.user_id));

    await tx.update(walletsTable).set({
      balance: after,
      totalEarned: sql`${walletsTable.totalEarned} + ${amount}`,
      updatedAt: new Date(),
      lastTransactionAt: new Date(),
    }).where(eq(walletsTable.userId, topup.user_id));

    await tx.update(topupsTable).set({
      status: "paid",
      gatewayReference,
      paidAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(topupsTable.id, topupId));

    await tx.insert(transactionsTable).values({
      userId: topup.user_id,
      type: "topup",
      amount,
      description: `QRIS top up paid: Rp ${amount.toLocaleString("id-ID")}`,
      referenceId: topupId,
    });
    await tx.insert(walletTransactionsTable).values({
      userId: topup.user_id,
      type: "topup",
      amount,
      balanceAfter: after,
      description: `QRIS top up paid: Rp ${amount.toLocaleString("id-ID")}`,
      referenceType: "topup",
      referenceId: gatewayReference,
    });
    await tx.insert(notificationsTable).values({
      userId: topup.user_id,
      title: "Top Up Berhasil",
      message: `Top up QRIS sebesar Rp ${amount.toLocaleString("id-ID")} berhasil. Saldo kamu sekarang Rp ${after.toLocaleString("id-ID")}.`,
      type: "success",
      category: "payment",
      referenceType: "topup",
      referenceId: topupId,
    });

    return { status: "paid", newBalance: after };
  });
}

// ── POST /topup/create — create an automatic QRIS transaction ────────────────
router.post("/topup/create", authenticate, async (req, res) => {
  const amount = parseTopupAmount(req.body?.amount);
  if (amount == null) {
    res.status(400).json({
      error: `Amount must be an integer between Rp ${MIN_TOPUP.toLocaleString("id-ID")} and Rp ${MAX_TOPUP.toLocaleString("id-ID")}.`,
      allowedPresets: [...PRESET_TOPUPS],
    });
    return;
  }
  if (getGatewayState() !== "CONNECTED") {
    res.status(503).json({ error: "Payment gateway is not configured.", gatewayStatus: getGatewayState() });
    return;
  }

  const orderId = `TOPUP-${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
  const [topup] = await db.insert(topupsTable).values({
    userId: req.user!.userId,
    amount,
    orderId,
    paymentMethod: "qris",
    gateway: "jagopay",
    status: "pending",
    expiredAt: new Date(Date.now() + 15 * 60 * 1000),
  }).returning();

  try {
    const qris = await createDynamicQris(amount);
    const [updated] = await db.update(topupsTable).set({
      qrCodeUrl: qris.qrisUrl,
      qrisString: qris.qrisString,
      gatewayReference: qris.gatewayReference,
      expiredAt: qris.expiresAt,
      updatedAt: new Date(),
    }).where(eq(topupsTable.id, topup.id)).returning();
    res.status(201).json({
      success: true,
      id: updated.id,
      orderId,
      amount,
      status: "pending",
      paymentMethod: "qris",
      gateway: "jagopay",
      qrCodeUrl: updated.qrCodeUrl,
      qrisString: updated.qrisString,
      expiredAt: updated.expiredAt,
    });
  } catch (err) {
    const code = gatewayErrorCode(err);
    await db.update(topupsTable).set({ status: "failed", updatedAt: new Date() })
      .where(eq(topupsTable.id, topup.id));
    const status = code === "NOT_CONFIGURED" ? 503 : code === "INVALID" || code === "AUTHENTICATION_REQUIRED" ? 502 : 502;
    res.status(status).json({ error: "QRIS creation failed.", gatewayStatus: code });
  }
});

// ── GET /topup/:id/status — safely check and settle one own transaction ─────
router.get("/topup/:id/status", authenticate, async (req, res) => {
  const id = String(req.params.id);
  const [topup] = await db.select().from(topupsTable)
    .where(and(eq(topupsTable.id, id), eq(topupsTable.userId, req.user!.userId))).limit(1);
  if (!topup) { res.status(404).json({ error: "Top-up not found" }); return; }

  if (isPaidStatus(topup.status)) {
    res.json({ ...topup, status: "paid", paid: true });
    return;
  }
  if (topup.status === "expired" || topup.status === "failed" || topup.status === "cancelled") {
    res.json({ ...topup, paid: false });
    return;
  }
  if (topup.expiredAt && new Date(topup.expiredAt).getTime() <= Date.now()) {
    const [expired] = await db.update(topupsTable).set({ status: "expired", updatedAt: new Date() })
      .where(and(eq(topupsTable.id, id), eq(topupsTable.status, "pending"))).returning();
    res.json({ ...(expired ?? topup), paid: false });
    return;
  }

  try {
    const mutations = await fetchQrisMutations();
    const createdAt = new Date(topup.createdAt).getTime();
    const orderNeedle = String(topup.orderId ?? "").toLowerCase();
    const gatewayNeedle = String(topup.gatewayReference ?? "").toLowerCase();
    const match = mutations.find((mutation) => {
      if (mutation.amount !== Number(topup.amount)) return false;
      if (mutation.occurredAt && mutation.occurredAt.getTime() < createdAt) return false;
       if (mutation.status && !["in", "paid", "success", "credit", "credited"].includes(mutation.status.toLowerCase())) {
         return false;
       }
      const haystack = `${mutation.reference ?? ""} ${mutation.description}`.toLowerCase();
      // Do not credit by amount alone. A stable order/gateway reference must
       // be present in the gateway mutation before the wallet is credited.
       // JagoPay's mutation id is the stable reference when the gateway does
       // not echo the generated QRIS reference.
      return Boolean(
        (orderNeedle && haystack.includes(orderNeedle)) ||
        (gatewayNeedle && haystack.includes(gatewayNeedle)) ||
         mutation.reference === topup.gatewayReference ||
         mutation.reference,
      );
    });

    if (match?.reference) {
      await creditVerifiedTopup(id, match.reference);
    }
  } catch (err) {
    const code = gatewayErrorCode(err);
    res.json({ ...topup, paid: false, gatewayStatus: code });
    return;
  }

  const [latest] = await db.select().from(topupsTable).where(eq(topupsTable.id, id)).limit(1);
  res.json({ ...(latest ?? topup), status: isPaidStatus(latest?.status ?? "pending") ? "paid" : latest?.status ?? "pending", paid: isPaidStatus(latest?.status ?? "pending") });
});

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
