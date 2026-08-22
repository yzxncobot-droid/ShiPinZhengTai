import { Router } from "express";
import crypto from "node:crypto";
import { db } from "@workspace/db";
import {
  topupsTable, usersTable, walletsTable, walletTransactionsTable,
  transactionsTable, notificationsTable, paymentProofsTable,
} from "@workspace/db";
import { eq, and, desc, sql, count } from "drizzle-orm";
import { authenticate, requireRole } from "../middlewares/auth";
import { qrisRateLimit } from "../middlewares/rate-limit";
import { invalidateUserCache, invalidateCache, keys } from "../lib/redis";
import { logger } from "../lib/logger";
import {
  createPaymentLink, temanqrisCallbackUrl, getOrder, gatewayErrorCode, getGatewayState, verifyWebhookSignature,
} from "../lib/temanqris";

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
    // Serialize all callbacks/polls for the same gateway mutation, even when
    // they point at different local rows. This closes the race where two
    // pending rows could both pass the duplicate-reference check.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${gatewayReference}))`);
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

// ── POST /topup/prepare — create a local pending topup before widget payment ──
// Creates a pending topup record with amount=0 and no order_id. The frontend
// calls this BEFORE opening the TemanQRIS widget, so it has a local
// transaction ID to poll. The amount and order_id are filled in later by
// POST /topup/:id/link (from the widget callback) or by the webhook (race
// condition handler).
router.post("/topup/prepare", authenticate, qrisRateLimit, async (req, res) => {
  // Reuse an existing non-expired pending topup if one exists.
  const [existingPending] = await db.select().from(topupsTable)
    .where(and(eq(topupsTable.userId, req.user!.userId), eq(topupsTable.status, "pending")))
    .orderBy(desc(topupsTable.createdAt))
    .limit(1);
  if (existingPending) {
    if (existingPending.expiredAt && new Date(existingPending.expiredAt).getTime() <= Date.now()) {
      await db.update(topupsTable).set({ status: "expired", updatedAt: new Date() })
        .where(and(eq(topupsTable.id, existingPending.id), eq(topupsTable.status, "pending")));
    } else {
      logger.info({ topupId: existingPending.id, userId: req.user!.userId }, "Topup prepare: reusing existing pending topup");
      res.status(201).json({
        id: existingPending.id,
        status: "pending",
        expiredAt: existingPending.expiredAt,
      });
      return;
    }
  }

  const [topup] = await db.insert(topupsTable).values({
    userId: req.user!.userId,
    amount: 0,
    paymentMethod: "qris",
    gateway: "temanqris",
    status: "pending",
    expiredAt: new Date(Date.now() + 15 * 60 * 1000),
  }).returning();

  logger.info({ topupId: topup.id, userId: req.user!.userId }, "Topup prepared (pending, awaiting widget payment)");

  res.status(201).json({
    id: topup.id,
    status: "pending",
    expiredAt: topup.expiredAt,
  });
});

// ── POST /topup/create — create an automatic QRIS transaction (API-based) ────
router.post("/topup/create", authenticate, qrisRateLimit, async (req, res) => {
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

  // Keep one active QRIS transaction per user. This also protects callers
  // that bypass the web UI and call the API directly.
  const [existingPending] = await db.select().from(topupsTable)
    .where(and(eq(topupsTable.userId, req.user!.userId), eq(topupsTable.status, "pending")))
    .orderBy(desc(topupsTable.createdAt))
    .limit(1);
  if (existingPending) {
    if (existingPending.expiredAt && new Date(existingPending.expiredAt).getTime() <= Date.now()) {
      await db.update(topupsTable).set({ status: "expired", updatedAt: new Date() })
        .where(and(eq(topupsTable.id, existingPending.id), eq(topupsTable.status, "pending")));
    } else {
      res.status(409).json({
        error: "You already have an active QRIS top-up.",
        topupId: existingPending.id,
        orderId: existingPending.orderId,
        expiredAt: existingPending.expiredAt,
      });
      return;
    }
  }

  const orderId = `TOPUP-${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
  const [topup] = await db.insert(topupsTable).values({
    userId: req.user!.userId,
    amount,
    orderId,
    paymentMethod: "qris",
    gateway: "temanqris",
    status: "pending",
    expiredAt: new Date(Date.now() + 15 * 60 * 1000),
  }).returning();

  try {
    const qris = await createPaymentLink({
      orderId,
      amount,
      returnUrl: temanqrisCallbackUrl(topup.id) ?? undefined,
    });
    const [updated] = await db.update(topupsTable).set({
      qrCodeUrl: qris.qrImage,
      qrisString: qris.qrisString,
      paymentLink: qris.paymentLink,
      gatewayReference: qris.orderId,
      expiredAt: qris.expiresAt ?? new Date(Date.now() + 15 * 60 * 1000),
      updatedAt: new Date(),
    }).where(eq(topupsTable.id, topup.id)).returning();
    res.status(201).json({
      success: true,
      id: updated.id,
      orderId,
      amount,
      status: "pending",
      paymentMethod: "qris",
      gateway: "temanqris",
      linkCode: qris.linkCode,
      qrCodeUrl: updated.qrCodeUrl,
      qrisString: updated.qrisString,
      paymentLink: qris.paymentLink,
      expiredAt: updated.expiredAt,
    });
  } catch (err) {
    const code = gatewayErrorCode(err);
    await db.update(topupsTable).set({ status: "failed", updatedAt: new Date() })
      .where(eq(topupsTable.id, topup.id));
    const status = code === "NOT_CONFIGURED" ? 503 : 502;
    res.status(status).json({ error: "QRIS creation failed.", gatewayStatus: code });
  }
});

// ── GET /topup/:id/status — safely check and settle one own transaction ─────
router.get("/topup/:id/status", authenticate, qrisRateLimit, async (req, res) => {
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

  // If the TemanQRIS API key is configured AND the topup has been linked
  // with an order_id AND has a non-zero amount, poll the gateway for the
  // latest status. Otherwise, rely solely on the webhook (the authoritative
  // source of truth) and return the local database status.
  if (getGatewayState() === "CONNECTED" && topup.orderId && Number(topup.amount) > 0) {
    try {
      const order = await getOrder(String(topup.orderId));
      const confirmed = ["paid", "success", "confirmed", "completed", "settled"].includes(order.status);
      if (confirmed) {
        if (order.orderId !== topup.orderId) {
          logger.warn({ topupId: id, orderId: topup.orderId, gatewayOrderId: order.orderId }, "Status check: order mismatch");
          res.json({ ...topup, paid: false, gatewayStatus: "ORDER_MISMATCH" });
          return;
        }
        if (order.amount != null && order.amount !== Number(topup.amount)) {
          logger.warn({ topupId: id, localAmount: topup.amount, gatewayAmount: order.amount }, "Status check: amount mismatch");
          res.json({ ...topup, paid: false, gatewayStatus: "AMOUNT_MISMATCH" });
          return;
        }
        await creditVerifiedTopup(id, order.orderId);
      } else if (order.status === "awaiting_confirmation") {
        await db.update(topupsTable).set({
          status: "awaiting_confirmation",
          updatedAt: new Date(),
        }).where(and(eq(topupsTable.id, id), eq(topupsTable.status, "pending")));
      }
    } catch (err) {
      const code = gatewayErrorCode(err);
      logger.warn({ topupId: id, code }, "Gateway status check failed, returning local status");
    }
  }

  const [latest] = await db.select().from(topupsTable).where(eq(topupsTable.id, id)).limit(1);
  res.json({ ...(latest ?? topup), status: isPaidStatus(latest?.status ?? "pending") ? "paid" : latest?.status ?? "pending", paid: isPaidStatus(latest?.status ?? "pending") });
});

// ── POST /topup/:id/link — link a local topup with a TemanQRIS order ─────────
// Called by the frontend after the widget callback redirect provides the
// TemanQRIS order_id and the amount the user entered. This sets the order_id
// and amount on the local topup record so the webhook can find it and the
// status endpoint can report it.
router.post("/topup/:id/link", authenticate, qrisRateLimit, async (req, res) => {
  const id = String(req.params.id);
  const orderId = String(req.body?.order_id ?? "").trim();
  const amount = Number(req.body?.amount);

  if (!orderId) {
    res.status(400).json({ error: "Missing order_id" });
    return;
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: "Invalid amount" });
    return;
  }

  const [topup] = await db.select().from(topupsTable)
    .where(and(eq(topupsTable.id, id), eq(topupsTable.userId, req.user!.userId))).limit(1);
  if (!topup) {
    res.status(404).json({ error: "Top-up not found" });
    return;
  }
  // If already paid, the webhook beat us — just return the current state.
  if (isPaidStatus(topup.status)) {
    res.json({ id: topup.id, status: "paid", paid: true, amount: topup.amount });
    return;
  }
  if (topup.status !== "pending") {
    res.status(400).json({ error: `Cannot link: top-up is already "${topup.status}"` });
    return;
  }
  // If already linked (e.g. webhook race condition), return current state.
  if (topup.orderId) {
    const [latest] = await db.select().from(topupsTable).where(eq(topupsTable.id, id)).limit(1);
    res.json({
      id: latest.id,
      status: isPaidStatus(latest.status) ? "paid" : latest.status,
      paid: isPaidStatus(latest.status),
      amount: latest.amount,
    });
    return;
  }

  await db.update(topupsTable).set({
    orderId,
    amount,
    updatedAt: new Date(),
  }).where(eq(topupsTable.id, id));

  logger.info({ topupId: id, orderId, amount }, "Topup linked with TemanQRIS order");

  // Re-read in case the webhook already updated the status.
  const [latest] = await db.select().from(topupsTable).where(eq(topupsTable.id, id)).limit(1);
  res.json({
    id: latest.id,
    status: isPaidStatus(latest.status) ? "paid" : latest.status,
    paid: isPaidStatus(latest.status),
    amount: latest.amount,
  });
});

// TemanQRIS calls this after its merchant verification. Only
// payment.confirmed is allowed to credit a wallet.
router.post("/webhooks/temanqris", async (req, res) => {
  const rawBody = (req as any).rawBody as Buffer | undefined;
  const signature = String(req.headers["x-temanqris-signature"] ?? req.headers["x-signature"] ?? "");
  if (!rawBody || !verifyWebhookSignature(rawBody, signature)) {
    logger.warn({ orderId: String((req.body as any)?.data?.order_id ?? "") }, "Webhook: invalid signature rejected");
    res.status(401).json({ error: "Invalid webhook signature" });
    return;
  }

  const body: any = req.body ?? {};
  const data: any = body.data ?? body.result ?? body;
  const event = String(body.event ?? body.type ?? data.event ?? data.type ?? "").toLowerCase();
  logger.info({ event, orderId: String(data.order_id ?? data.orderId ?? "") }, "Webhook received");
  if (event !== "payment.confirmed") {
    if (event === "payment.awaiting_confirmation") {
      const awaitingOrderId = String(
        data.order_id ?? data.orderId ?? data.merchant_order_id ?? "",
      ).trim();
      if (awaitingOrderId) {
        await db.update(topupsTable).set({
          status: "awaiting_confirmation",
          updatedAt: new Date(),
        }).where(and(
          eq(topupsTable.orderId, awaitingOrderId),
          eq(topupsTable.status, "pending"),
        ));
      }
    }
    res.json({ received: true, ignored: true });
    return;
  }

  const orderId = String(data.order_id ?? data.orderId ?? data.merchant_order_id ?? "").trim();
  if (!orderId) {
    res.status(400).json({ error: "Missing order_id" });
    return;
  }
  const [topup] = await db.select().from(topupsTable)
    .where(eq(topupsTable.orderId, orderId)).limit(1);
  const gatewayReference = String(
    data.transaction_id ?? data.transactionId ?? data.reference ?? orderId,
  ).trim();

  if (!topup) {
    // Widget-based payment: no pre-existing topup record. The TemanQRIS
    // widget creates the payment link client-side; the backend only learns
    // about it via this webhook. Extract the user ID from the description
    // (set by the frontend widget's data-description attribute) to
    // associate the payment with a user, create a topup record, and credit
    // the wallet. The webhook signature is already verified above, so the
    // payload is authentic.
    const description = String(data.description ?? "");
    const userMatch = description.match(
      /user:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/,
    );
    if (!userMatch) {
      res.json({ received: true, ignored: true });
      return;
    }
    const widgetUserId = userMatch[1];
    const [widgetUser] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, widgetUserId))
      .limit(1);
    if (!widgetUser) {
      res.json({ received: true, ignored: true });
      return;
    }
    const widgetAmount = Number(data.amount ?? data.nominal ?? NaN);
    if (!Number.isFinite(widgetAmount) || widgetAmount <= 0) {
      res.json({ received: true, ignored: true });
      return;
    }

    // Race condition: the webhook arrived before the frontend called
    // /topup/:id/link. Try to find a pending topup created by /topup/prepare
    // for this user and link it with the order_id + amount.
    const [pendingTopup] = await db.select().from(topupsTable)
      .where(and(
        eq(topupsTable.userId, widgetUserId),
        eq(topupsTable.status, "pending"),
      ))
      .orderBy(desc(topupsTable.createdAt))
      .limit(1);

    if (pendingTopup) {
      await db.update(topupsTable).set({
        orderId,
        amount: widgetAmount,
        updatedAt: new Date(),
      }).where(eq(topupsTable.id, pendingTopup.id));

      logger.info({ topupId: pendingTopup.id, orderId, userId: widgetUserId, amount: widgetAmount }, "Webhook linked pending topup with order_id");

      const widgetResult = await creditVerifiedTopup(pendingTopup.id, gatewayReference);
      if (widgetResult.status === "paid" || widgetResult.status === "already_processed") {
        await invalidateUserCache(widgetUserId).catch(() => {});
        await invalidateCache(keys.analytics("overview")).catch(() => {});
      }
      res.json({ received: true, status: widgetResult.status });
      return;
    }

    // No pending topup found — create a new one (no /topup/prepare was called).
    try {
      const [newTopup] = await db
        .insert(topupsTable)
        .values({
          userId: widgetUserId,
          amount: widgetAmount,
          orderId,
          paymentMethod: "qris",
          gateway: "temanqris",
          status: "pending",
        })
        .returning();

      logger.info({ topupId: newTopup.id, orderId, userId: widgetUserId, amount: widgetAmount }, "Webhook created new topup for widget payment");

      const widgetResult = await creditVerifiedTopup(
        newTopup.id,
        gatewayReference,
      );
      if (
        widgetResult.status === "paid" ||
        widgetResult.status === "already_processed"
      ) {
        await invalidateUserCache(widgetUserId).catch(() => {});
        await invalidateCache(keys.analytics("overview")).catch(() => {});
      }
      res.json({ received: true, status: widgetResult.status });
      return;
    } catch (insertErr: any) {
      // Unique constraint on order_id — another concurrent webhook beat us.
      if (String(insertErr?.cause?.code ?? insertErr?.code) === "23505") {
        const [existing] = await db
          .select()
          .from(topupsTable)
          .where(eq(topupsTable.orderId, orderId))
          .limit(1);
        if (existing) {
          const existingResult = await creditVerifiedTopup(
            existing.id,
            gatewayReference,
          );
          if (
            existingResult.status === "paid" ||
            existingResult.status === "already_processed"
          ) {
            await invalidateUserCache(existing.userId).catch(() => {});
            await invalidateCache(keys.analytics("overview")).catch(() => {});
          }
          res.json({ received: true, status: existingResult.status });
          return;
        }
      }
      logger.error({ err: insertErr, orderId }, "Widget topup insert failed");
    }
    res.json({ received: true, ignored: true });
    return;
  }
  const webhookAmount = Number(data.amount ?? data.nominal ?? NaN);
  if (Number.isFinite(webhookAmount) && webhookAmount !== Number(topup.amount)) {
    res.status(400).json({ error: "Webhook amount does not match top-up amount" });
    return;
  }
  const result = await creditVerifiedTopup(topup.id, gatewayReference);
  if (result.status === "paid" || result.status === "already_processed") {
    await invalidateUserCache(topup.userId).catch(() => {});
    await invalidateCache(keys.analytics("overview")).catch(() => {});
  }
  res.json({ received: true, status: result.status });
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

// ── POST /topups — DISABLED (legacy manual top-up with payment proof) ─────────
// The old manual proof-based top-up system is retired in favour of the
// automatic TemanQRIS widget flow (POST /topup/create). Historical rows are
// preserved; only new manual submissions are blocked.
router.post("/topups", authenticate, async (_req, res) => {
  res.status(410).json({
    error: "Top up manual sudah dinonaktifkan. Silakan gunakan tombol Top Up QRIS otomatis.",
  });
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
