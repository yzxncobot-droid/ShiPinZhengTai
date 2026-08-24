import { Router } from "express";
import crypto from "node:crypto";
import { db } from "@workspace/db";
import {
  topupsTable, usersTable,
  notificationsTable, paymentProofsTable,
} from "@workspace/db";
import { eq, and, desc, count } from "drizzle-orm";
import { authenticate, requireRole } from "../middlewares/auth";
import { qrisRateLimit } from "../middlewares/rate-limit";
import { invalidateUserCache, invalidateCache, keys } from "../lib/redis";
import { logger } from "../lib/logger";
import {
  temanqrisCallbackUrl, temanqrisWebhookUrl, getOrder, gatewayErrorCode, getGatewayState, verifyWebhookSignature, isWebhookConfigured, generateQris,
} from "../lib/temanqris";
import {
  creditVerifiedTopup,
  finalizeVerifiedTopup,
  linkPendingWidgetTopup,
  extractUserIdFromDescription,
  verifyAndCreditTopup,
} from "../lib/topup-verification";

const router = Router();

const MIN_TOPUP = 100;
const MAX_TOPUP = 1_000_000;
const PRESET_TOPUPS = new Set([1_000, 3_000, 5_000, 10_000, 20_000, 50_000]);

function parseTopupAmount(value: unknown): number | null {
  const amount = Number(value);
  if (!Number.isInteger(amount) || amount < MIN_TOPUP || amount > MAX_TOPUP) return null;
  return amount;
}

function isPaidStatus(status: string): boolean {
  return status === "paid" || status === "confirmed";
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
    // Generate a dynamic QRIS with webhook + callback so TemanQRIS notifies our
    // server automatically when the customer pays. /generate returns both the
    // QR image (Base64) and a hosted payment link, giving the frontend the best
    // UX: an inline QR code plus a "Bayar Sekarang" button to the hosted page.
    const webhookUrl = temanqrisWebhookUrl();
    const callbackUrl = temanqrisCallbackUrl(topup.id) ?? undefined;
    const qris = await generateQris({
      amount,
      orderId,
      webhookUrl: webhookUrl ?? undefined,
      callbackUrl: callbackUrl ?? undefined,
    });
    const paymentLinkUrl = qris.paymentLink.url
      ?? (qris.paymentLink.linkCode ? `https://temanqris.com/p/${qris.paymentLink.linkCode}` : null);
    const [updated] = await db.update(topupsTable).set({
      qrCodeUrl: qris.qrImage,
      qrisString: qris.qrisString,
      paymentLink: paymentLinkUrl,
      gatewayReference: qris.paymentLink.orderId ?? orderId,
      expiredAt: qris.expiresAt ?? qris.paymentLink.expiresAt ?? new Date(Date.now() + 15 * 60 * 1000),
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
      linkCode: qris.paymentLink.linkCode,
      qrCodeUrl: updated.qrCodeUrl,
      qrisString: updated.qrisString,
      paymentLink: paymentLinkUrl,
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

  // Read-only status check: poll getOrder() (GET — never verifyOrder/POST)
  // to see if TemanQRIS itself reports the order as paid. If so, finalize via
  // the single credit path. awaiting_confirmation is NEVER treated as paid
  // and NEVER triggers verifyOrder() — it stays pending until a valid
  // payment.confirmed webhook arrives (or getOrder() reports paid).
  if (getGatewayState() === "CONNECTED" && topup.orderId && Number(topup.amount) > 0) {
    try {
      const order = await getOrder(String(topup.orderId));
      const confirmed = ["paid", "success", "confirmed", "completed", "settled"].includes(order.status);
      if (confirmed) {
        // getOrder already shows paid — finalize directly.
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
        await finalizeVerifiedTopup(String(topup.orderId), order.amount ?? undefined);
      }
      // awaiting_confirmation and all other non-paid statuses: stay pending,
      // do NOT call verifyOrder(), do NOT credit.
    } catch (err) {
      const code = gatewayErrorCode(err);
      logger.warn({ topupId: id, code }, "Gateway status check failed, returning local status");
    }
  }

  const [latest] = await db.select().from(topupsTable).where(eq(topupsTable.id, id)).limit(1);
  res.json({ ...(latest ?? topup), status: isPaidStatus(latest?.status ?? "pending") ? "paid" : latest?.status ?? "pending", paid: isPaidStatus(latest?.status ?? "pending") });
});

// ── POST /topup/:id/confirm-paid — user pressed "Sudah Bayar" ────────────────
// Authenticated endpoint triggered by the frontend "Sudah Bayar" button.
// Accepts ONLY { topupId } — amount/userId/orderId are read from the DB,
// never from the request body. Sets status to awaiting_confirmation, then
// immediately checks TemanQRIS for actual payment. Only credits if getOrder()
// reports paid AND order_id + amount + user all match. awaiting_confirmation
// is NEVER treated as payment success.
router.post("/topup/:id/confirm-paid", authenticate, qrisRateLimit, async (req, res) => {
  const topupId = String(req.params.id);
  const userId = req.user!.userId;

  logger.info({ topupId, userId }, "[TQ-AUTO] confirm-paid request received");

  const result = await verifyAndCreditTopup(topupId, userId);

  if (result.success) {
    res.json(result);
  } else if (result.status === "awaiting_payment") {
    res.json(result);
  } else {
    res.status(400).json(result);
  }
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
  if (!isWebhookConfigured()) {
    logger.error("Webhook: TEMANQRIS_WEBHOOK_SECRET is not configured — rejecting webhook (not bypassing security)");
    res.status(503).json({ error: "Webhook secret is not configured. Set TEMANQRIS_WEBHOOK_SECRET." });
    return;
  }
  if (!rawBody || !verifyWebhookSignature(rawBody, signature)) {
    logger.warn({ orderId: String((req.body as any)?.data?.order_id ?? "") }, "Webhook: invalid signature rejected");
    res.status(401).json({ error: "Invalid webhook signature" });
    return;
  }

  const body: any = req.body ?? {};
  const data: any = body.data ?? body.result ?? body;
  const event = String(body.event ?? body.type ?? data.event ?? data.type ?? "").toLowerCase();
  logger.info({ event, orderId: String(data.order_id ?? data.orderId ?? "") }, "[TQ-AUTO] webhook received");
  if (event !== "payment.confirmed") {
    if (event === "payment.awaiting_confirmation") {
      const awaitingOrderId = String(
        data.order_id ?? data.orderId ?? data.merchant_order_id ?? "",
      ).trim();
      if (!awaitingOrderId) {
        res.json({ received: true, ignored: true });
        return;
      }
      logger.info({ orderId: awaitingOrderId }, "[TQ-AUTO] awaiting_confirmation received");

      // Set status on the linked topup.
      await db.update(topupsTable).set({
        status: "awaiting_confirmation",
        updatedAt: new Date(),
      }).where(and(
        eq(topupsTable.orderId, awaitingOrderId),
        eq(topupsTable.status, "pending"),
      ));

      // Race condition: the webhook arrived before /topup/:id/link. Try
      // to find a pending widget top-up via the description user ID.
      const [existing] = await db.select().from(topupsTable)
        .where(eq(topupsTable.orderId, awaitingOrderId)).limit(1);
      if (!existing) {
        const description = String(data.description ?? "");
        const widgetAmount = Number(data.amount ?? data.nominal ?? NaN);
        await linkPendingWidgetTopup(awaitingOrderId, description, widgetAmount);
      }

      // ── SECURITY: awaiting_confirmation is NOT proof of payment ──
      // We deliberately do NOT call verifyOrder() (POST /orders/:id/verify)
      // here. That endpoint performs merchant confirmation which can mark
      // an order as "paid" without the customer actually paying — the root
      // cause of the free-saldo bug. The wallet is only credited via
      // creditVerifiedTopup() when:
      //   - the user presses "Sudah Bayar" (POST /topup/:id/confirm-paid) and
      //     getOrder() reports a confirmed status, OR
      //   - a valid payment.confirmed webhook arrives (below).
      // Do NOT credit, do NOT auto-verify, do NOT finalize.
      res.json({ received: true });
      return;
    }
    res.json({ received: true, ignored: true });
    return;
  }

  const orderId = String(data.order_id ?? data.orderId ?? data.merchant_order_id ?? "").trim();
  if (!orderId) {
    res.status(400).json({ error: "Missing order_id" });
    return;
  }
  logger.info({ orderId }, "[TQ-AUTO] payment.confirmed received");
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
    const widgetUserId = extractUserIdFromDescription(String(data.description ?? ""));
    if (!widgetUserId) {
      res.json({ received: true, ignored: true });
      return;
    }
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

      logger.info({ topupId: pendingTopup.id, orderId, userId: widgetUserId, amount: widgetAmount }, "[TQ-AUTO] webhook linked pending topup with order_id");

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

      logger.info({ topupId: newTopup.id, orderId, userId: widgetUserId, amount: widgetAmount }, "[TQ-AUTO] webhook created new topup for widget payment");

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
    logger.error({ orderId, topupId: topup.id, localAmount: topup.amount, webhookAmount }, "[TQ-AUTO] amount mismatch (webhook) — NOT crediting");
    res.status(400).json({ error: "Webhook amount does not match top-up amount" });
    return;
  }
  logger.info({ orderId, topupId: topup.id }, "[TQ-AUTO] creditVerifiedTopup — webhook confirmed");
  const result = await creditVerifiedTopup(topup.id, gatewayReference);
  logger.info({ orderId, topupId: topup.id, creditStatus: result.status }, "[TQ-AUTO] credit completed (webhook confirmed)");
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

// ── POST /topups — manual top-up with payment proof ─────────────────────────
// Creates a pending top-up with an uploaded payment-proof screenshot. The
// owner/admin reviews it and confirms/denies via PATCH /topups/:id/confirm.
router.post("/topups", authenticate, async (req, res) => {
  const userId = req.user!.userId;
  const amount = parseTopupAmount(req.body?.amount);
  if (amount == null) {
    res.status(400).json({
      error: `Nominal harus bulat antara Rp ${MIN_TOPUP.toLocaleString("id-ID")} dan Rp ${MAX_TOPUP.toLocaleString("id-ID")}.`,
    });
    return;
  }
  const paymentProof = String(req.body?.paymentProof ?? "").trim();
  if (!paymentProof) {
    res.status(400).json({ error: "Bukti transfer wajib diunggah." });
    return;
  }

  const parsedTransfer = req.body?.transferAmount != null ? Number(req.body.transferAmount) : null;
  const amountMatchStatus =
    parsedTransfer != null && parsedTransfer !== amount ? "mismatch" : "match";

  // Store the proof screenshot in a dedicated payment_proofs record so the
  // admin can review it during approval.
  const [proof] = await db.insert(paymentProofsTable).values({
    userId,
    imageUrl: paymentProof,
    claimedAmount: String(amount),
    status: "pending",
  }).returning();

  const [topup] = await db.insert(topupsTable).values({
    userId,
    amount,
    paymentMethod: "qris",
    paymentProof,
    paymentProofId: proof.id,
    transferAmount: parsedTransfer ?? amount,
    amountMatchStatus,
    status: "pending",
  }).returning();

  logger.info({ topupId: topup.id, userId, amount }, "Manual topup created (pending owner approval)");

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
// Credits via the SINGLE credit path (creditVerifiedTopup) so all wallet
// balance increases for top-ups go through one audited, idempotent function
// with advisory-lock + duplicate-reference protection.
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

    logger.info({ topupId: id, userId: topup.userId, amount: topup.amount, by: reviewerId }, "[TQ-AUTO] admin confirm: crediting via creditVerifiedTopup");

    // Credit through the single credit path. Use a unique admin reference
    // so the duplicate-reference guard in creditVerifiedTopup prevents
    // double-crediting if confirm is called twice.
    const gatewayReference = `admin-${id}`;
    const result = await creditVerifiedTopup(id, gatewayReference);

    if (result.status !== "paid" && result.status !== "already_processed") {
      res.status(400).json({ error: `Failed to confirm top-up: credit status ${result.status}` });
      return;
    }

    // Record reviewer metadata + approve the payment proof (outside the
    // credit transaction — the balance is already updated safely).
    await db.update(topupsTable).set({
      reviewedBy: reviewerId,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(topupsTable.id, id));

    if (topup.paymentProofId) {
      await db.update(paymentProofsTable).set({
        status: "approved", reviewedBy: reviewerId, reviewedAt: new Date(), updatedAt: new Date(),
      }).where(eq(paymentProofsTable.id, topup.paymentProofId));
      logger.info({ topupId: id, proofId: topup.paymentProofId }, "[TQ-AUTO] admin confirm: payment proof approved");
    }

    await invalidateUserCache(topup.userId);
    await invalidateCache(keys.analytics("overview")).catch(() => {});

    const [updated] = await db.select().from(topupsTable).where(eq(topupsTable.id, id)).limit(1);
    logger.info({ topupId: id, userId: topup.userId, amount: topup.amount, by: reviewerId }, "[TQ-AUTO] admin confirm: success");
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
