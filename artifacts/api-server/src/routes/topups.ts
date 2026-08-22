import { Router } from "express";
import { db } from "@workspace/db";
import {
  topupsTable, usersTable, walletsTable, walletTransactionsTable,
  transactionsTable, notificationsTable, paymentProofsTable,
} from "@workspace/db";
import { eq, and, or, desc, sql, count, lt, gt, inArray } from "drizzle-orm";
import { authenticate, requireRole } from "../middlewares/auth";
import { qrisRateLimit } from "../middlewares/rate-limit";
import { invalidateUserCache, invalidateCache, keys } from "../lib/redis";
import { logger } from "../lib/logger";
import {
  createPaymentLink, getOrder, cancelOrder, verifyOrder,
  gatewayErrorCode, getGatewayState, verifyWebhookSignature,
} from "../lib/temanqris";

const router = Router();

const MIN_TOPUP = 100;
const MAX_TOPUP = 1_000_000;
const PRESET_TOPUPS = new Set([1_000, 5_000, 10_000, 15_000, 25_000, 50_000]);

/**
 * A pending (menunggu) QRIS order is automatically cancelled this long after it
 * is created — and only while it is still pending. Paid/verified orders are
 * never cancelled. Keeps no payment lingering in "menunggu".
 */
const AUTO_CANCEL_MS = 5 * 60 * 1000;

const VERIFIED_STATUSES = ["paid", "success", "confirmed", "completed", "settled"];

function parseTopupAmount(value: unknown): number | null {
  const amount = Number(value);
  if (!Number.isInteger(amount) || amount < MIN_TOPUP || amount > MAX_TOPUP) return null;
  return amount;
}

function isPaidStatus(status: string): boolean {
  return status === "paid" || status === "confirmed";
}

function isVerifiedGatewayStatus(status: string): boolean {
  return VERIFIED_STATUSES.includes(status);
}

/** Best-effort: tell TemanQRIS to cancel an order. Never throws — cancelling
 *  a payment that the gateway already marked paid is handled by the caller. */
async function cancelOrderAtGateway(orderId: string | null): Promise<void> {
  if (!orderId) return;
  try {
    await cancelOrder(orderId);
  } catch (err: any) {
    logger.warn({ err: err?.message, orderId }, "topup: gateway cancel failed (best-effort)");
  }
}

/**
 * Cancel every pending top-up older than AUTO_CANCEL_MS at the gateway and
 * locally. Runs on startup, before creating a new top-up, and on status
 * checks. Guarantees no payment lingers in "menunggu" (pending) past 5 min.
 */
export async function sweepStalePendingTopups(limit = 50): Promise<number> {
  const cutoff = new Date(Date.now() - AUTO_CANCEL_MS);
  const stale = await db
    .select({ id: topupsTable.id, orderId: topupsTable.orderId, status: topupsTable.status })
    .from(topupsTable)
    .where(and(eq(topupsTable.status, "pending"), lt(topupsTable.createdAt, cutoff)))
    .limit(limit);

  for (const t of stale) {
    await cancelOrderAtGateway(t.orderId);
    await db
      .update(topupsTable)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(and(eq(topupsTable.id, t.id), eq(topupsTable.status, "pending")));
  }
  return stale.length;
}

/**
 * Auto-settle verified top-ups — the "full automatic" path. Polls every
 * pending / awaiting_confirmation TemanQRIS top-up against the gateway
 * (GET /orders/:id, read-only) and credits the wallet the moment TemanQRIS
 * reports the order paid. No merchant action is needed: the customer pays,
 * TemanQRIS detects the QRIS transfer, and the wallet is credited.
 *
 * It never calls the gateway "verify" action, so it cannot mint balance
 * without a real payment. Runs on startup and on a 30s interval.
 */
export async function settlePaidTopups(limit = 50): Promise<number> {
  // Pending orders are only checked within a short recent window (they are
  // short-lived and auto-cancelled after 5 min). Awaiting-confirmation orders
  // are checked regardless of age so payments stuck there are always
  // resolved — to paid via a Verify Order retry, or cancelled if the gateway
  // order already expired.
  const since = new Date(Date.now() - AUTO_CANCEL_MS * 6);
  const candidates = await db
    .select({ id: topupsTable.id, orderId: topupsTable.orderId, userId: topupsTable.userId, status: topupsTable.status })
    .from(topupsTable)
    .where(and(
      eq(topupsTable.gateway, "temanqris"),
      or(
        and(eq(topupsTable.status, "pending"), gt(topupsTable.createdAt, since)),
        eq(topupsTable.status, "awaiting_confirmation"),
      ),
    ))
    .limit(limit);

  let settled = 0;
  for (const t of candidates) {
    if (!t.orderId) continue;
    try {
      // Read the gateway status first (idempotent). Credit at once if already paid.
      const checked = await getOrder(String(t.orderId));
      if (isVerifiedGatewayStatus(checked.status)) {
        const result = await creditVerifiedTopup(t.id, checked.orderId);
        if (result.status === "paid") {
          settled++;
          await invalidateUserCache(t.userId).catch(() => {});
          await invalidateCache(keys.analytics("overview")).catch(() => {});
          logger.info({ topupId: t.id, orderId: t.orderId }, "topup: auto-settled via gateway poll");
        }
        continue;
      }

      if (t.status === "awaiting_confirmation") {
        // The customer already clicked "Sudah Bayar" but the gateway never
        // marked the order paid — the payment is stuck. Resolve it:
        if (checked.status === "cancelled" || checked.status === "expired") {
          // The gateway order lapsed — cancel locally so it stops lingering.
          await db.update(topupsTable).set({ status: "cancelled", updatedAt: new Date() })
            .where(eq(topupsTable.id, t.id));
          logger.info({ topupId: t.id, orderId: t.orderId }, "topup: stuck awaiting -> cancelled (gateway expired)");
        } else {
          // Perform the "Verify Order" action the customer's click requested,
          // then credit. Retrying every sweep clears the stuck state.
          try {
            const verified = await verifyOrder(String(t.orderId));
            if (isVerifiedGatewayStatus(verified.status)) {
              const result = await creditVerifiedTopup(t.id, verified.orderId);
              if (result.status === "paid") {
                settled++;
                await invalidateUserCache(t.userId).catch(() => {});
                await invalidateCache(keys.analytics("overview")).catch(() => {});
                logger.info({ topupId: t.id, orderId: t.orderId }, "topup: stuck awaiting -> paid via Verify Order retry");
              }
            }
          } catch (verifyErr: any) {
            logger.warn({ err: verifyErr?.message, topupId: t.id, orderId: t.orderId }, "topup: Verify Order retry failed (will retry next sweep)");
          }
        }
      } else if (checked.status === "awaiting_confirmation") {
        // Pending locally, but the customer confirmed at the gateway — sync.
        await db.update(topupsTable).set({ status: "awaiting_confirmation", updatedAt: new Date() })
          .where(and(eq(topupsTable.id, t.id), eq(topupsTable.status, "pending")));
      }
    } catch (err: any) {
      logger.warn({ err: err?.message, topupId: t.id, orderId: t.orderId }, "topup: auto-settle check failed (best-effort)");
    }
  }
  return settled;
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
    // A top-up awaiting the merchant's confirmation may still be credited by a
    // signed gateway signal (webhook / gateway "paid"). Only terminal non-paid
    // states block crediting.
    if (String(topup.status) !== "pending" && String(topup.status) !== "awaiting_confirmation") {
      return { status: String(topup.status) };
    }

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

  // Sweep any pending (menunggu) orders past the 5-min auto-cancel window so
  // nothing lingers — for this user and globally.
  await sweepStalePendingTopups().catch((e) =>
    logger.warn({ err: (e as any)?.message }, "topup: stale sweep failed"),
  );

  // Keep one active QRIS transaction per user. This also protects callers
  // that bypass the web UI and call the API directly.
  const [existingPending] = await db.select().from(topupsTable)
    .where(and(eq(topupsTable.userId, req.user!.userId), inArray(topupsTable.status, ["pending", "awaiting_confirmation"])))
    .orderBy(desc(topupsTable.createdAt))
    .limit(1);
  if (existingPending) {
    const createdAt = new Date(existingPending.createdAt).getTime();
    if (existingPending.status === "pending" && Date.now() - createdAt >= AUTO_CANCEL_MS) {
      // Stale menunggu — cancel at the gateway and locally, then proceed to create a new one.
      await cancelOrderAtGateway(existingPending.orderId);
      await db.update(topupsTable).set({ status: "cancelled", updatedAt: new Date() })
        .where(and(eq(topupsTable.id, existingPending.id), eq(topupsTable.status, "pending")));
    } else if (existingPending.status === "awaiting_confirmation") {
      // The customer already clicked "Sudah Bayar" — it must stay until the
      // merchant verifies funds. Do not let them open a second order to game it.
      res.status(409).json({
        error: "Pembayaran kamu sedang menunggu verifikasi penjual. Tunggu hingga terverifikasi.",
        topupId: existingPending.id,
        orderId: existingPending.orderId,
        expiredAt: existingPending.expiredAt,
      });
      return;
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
    expiredAt: new Date(Date.now() + AUTO_CANCEL_MS),
  }).returning();

  try {
    const qris = await createPaymentLink({ orderId, amount });
    // The local 5-min auto-cancel window always wins — never adopt the
    // gateway's (possibly much longer) expiry, so menunggu orders are cancelled
    // exactly 5 min after creation.
    const [updated] = await db.update(topupsTable).set({
      qrCodeUrl: qris.qrImage,
      qrisString: qris.qrisString,
      gatewayReference: qris.orderId,
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

  // Already verified — nothing to do. The wallet was credited when verified.
  if (isPaidStatus(topup.status)) {
    res.json({ ...topup, status: "paid", paid: true });
    return;
  }
  // Already cancelled somehow (e.g. by the user) — reflect terminal state.
  if (topup.status === "cancelled" || topup.status === "denied" || topup.status === "failed") {
    res.json({ ...topup, paid: false });
    return;
  }

  // Auto-cancel: pending past the 5-min window. Only menunggu orders are
  // cancelled; anything the gateway verified as paid is credited instead.
  const createdAt = new Date(topup.createdAt).getTime();
  const pastAutoCancel = Date.now() - createdAt >= AUTO_CANCEL_MS;
  if (pastAutoCancel && topup.status === "pending") {
    // Before cancelling, make sure the gateway did not already verify it paid.
    try {
      const checked = await getOrder(String(topup.orderId));
      if (isVerifiedGatewayStatus(checked.status)) {
        const result = await creditVerifiedTopup(id, checked.orderId);
        if (result.status === "paid") {
          await invalidateUserCache(topup.userId).catch(() => {});
        }
        const [latest] = await db.select().from(topupsTable).where(eq(topupsTable.id, id)).limit(1);
        res.json({ ...(latest ?? topup), status: "paid", paid: true });
        return;
      }
    } catch (err) {
      logger.warn({ err: (err as any)?.message, id }, "topup: pre-cancel check failed");
    }
    await cancelOrderAtGateway(topup.orderId);
    const [cancelled] = await db.update(topupsTable).set({ status: "cancelled", updatedAt: new Date() })
      .where(and(eq(topupsTable.id, id), eq(topupsTable.status, "pending"))).returning();
    res.json({ ...(cancelled ?? topup), status: "cancelled", paid: false });
    return;
  }

  if (topup.status === "expired") {
    res.json({ ...topup, paid: false });
    return;
  }

  // CRITICAL SECURITY: this endpoint MUST NOT call the gateway "verify"
  // action. TemanQRIS /orders/:id/verify marks an order "paid" instantly
  // WITHOUT any real payment, so letting the customer's "Sudah Bayar" button
  // trigger it would grant free wallet balance with no transfer. The wallet
  // is credited here ONLY when TemanQRIS itself already reports the order
  // "paid" (i.e. the merchant/gateway verified real funds arrived), or when
  // the signed payment.confirmed webhook — which no customer can forge —
  // settles it. Checkout is read-only (GET /orders) so a click never mints
  // balance. Only an authenticated owner may mark a payment verified via the
  // admin confirm/deny routes below.
  try {
    const checked = await getOrder(String(topup.orderId));
    if (isVerifiedGatewayStatus(checked.status)) {
      // Gateway itself marked it paid (real funds) — credit and finish.
      const result = await creditVerifiedTopup(id, checked.orderId);
      if (result.status === "paid") {
        await invalidateUserCache(topup.userId).catch(() => {});
      }
      const [latest] = await db.select().from(topupsTable).where(eq(topupsTable.id, id)).limit(1);
      res.json({ ...(latest ?? topup), status: "paid", paid: true });
      return;
    }
    if (checked.status === "cancelled" || checked.status === "expired") {
      const [ended] = await db.update(topupsTable)
        .set({ status: checked.status === "cancelled" ? "cancelled" : "expired", updatedAt: new Date() })
        .where(and(eq(topupsTable.id, id), eq(topupsTable.status, "pending"))).returning();
      res.json({ ...(ended ?? topup), paid: false });
      return;
    }
    // Gateway says the customer confirmed payment — sync our local status so
    // the merchant's verification queue reflects "menunggu verifikasi". No credit.
    if (checked.status === "awaiting_confirmation" && topup.status === "pending") {
      await db.update(topupsTable).set({ status: "awaiting_confirmation", updatedAt: new Date() })
        .where(and(eq(topupsTable.id, id), eq(topupsTable.status, "pending")));
      res.json({ ...topup, status: "awaiting_confirmation", paid: false, gatewayStatus: "awaiting_confirmation" });
      return;
    }
    // Payment not yet verified at the gateway — return the real local status
    // (pending OR awaiting_confirmation), never credit on a customer poll.
    const [latest] = await db.select().from(topupsTable).where(eq(topupsTable.id, id)).limit(1);
    const localStatus = latest?.status ?? "pending";
    res.json({ ...(latest ?? topup), status: localStatus, paid: false, gatewayStatus: checked.status });
    return;
  } catch (err) {
    const code = gatewayErrorCode(err);
    res.json({ ...topup, paid: false, gatewayStatus: code });
    return;
  }
});

// ── POST /topup/:id/mark-paid — customer clicks "Saya Sudah Bayar" ───────────
// Full-automatic TemanQRIS flow (per "Verify Order" docs):
//   4. Customer klik "Sudah Bayar"  -> status = awaiting_confirmation
//   8. Call POST /orders/:orderId/verify -> status = paid, wallet credited
// The click performs the merchant "Verify Order" action, so the order is
// marked paid and the wallet is credited immediately — no manual approval.
router.post("/topup/:id/mark-paid", authenticate, qrisRateLimit, async (req, res) => {
  const id = String(req.params.id);
  const [topup] = await db.select().from(topupsTable)
    .where(and(eq(topupsTable.id, id), eq(topupsTable.userId, req.user!.userId))).limit(1);
  if (!topup) { res.status(404).json({ error: "Top-up not found" }); return; }

  if (isPaidStatus(topup.status)) { res.json({ ...topup, status: "paid", paid: true }); return; }
  if (topup.status === "cancelled" || topup.status === "denied" || topup.status === "failed" || topup.status === "expired") {
    res.json({ ...topup, paid: false }); return;
  }
  if (topup.status !== "pending" && topup.status !== "awaiting_confirmation") {
    res.status(409).json({ error: "Top-up cannot be marked paid in its current state." }); return;
  }

  // Step 4: move to awaiting_confirmation (matches the documented flow).
  if (topup.status === "pending") {
    await db.update(topupsTable).set({ status: "awaiting_confirmation", updatedAt: new Date() })
      .where(and(eq(topupsTable.id, id), eq(topupsTable.status, "pending")));
  }

  // Step 8: "Verify Order" — POST /orders/:orderId/verify marks the gateway
  // order as paid, then we credit the wallet. Best-effort: a gateway error
  // (e.g. order not ready) falls back to awaiting_confirmation for the
  // auto-settle sweep / merchant to retry.
  if (topup.gateway === "temanqris" && topup.orderId) {
    try {
      const verified = await verifyOrder(String(topup.orderId));
      if (isVerifiedGatewayStatus(verified.status)) {
        const result = await creditVerifiedTopup(id, verified.orderId);
        if (result.status === "paid") {
          await invalidateUserCache(topup.userId).catch(() => {});
          await invalidateCache(keys.analytics("overview")).catch(() => {});
          logger.info({ topupId: id, orderId: topup.orderId }, "topup: mark-paid -> verify -> paid (auto)");
        }
        const [latest] = await db.select().from(topupsTable).where(eq(topupsTable.id, id)).limit(1);
        res.json({ ...(latest ?? topup), status: "paid", paid: true });
        return;
      }
    } catch (err: any) {
      logger.warn({ err: err?.message ?? err, id, orderId: topup.orderId }, "topup: mark-paid gateway verify failed (fallback to awaiting)");
    }
  }

  // Fallback: gateway verify did not confirm paid — leave it awaiting and
  // notify owners so they can verify funds manually if needed.
  try {
    const owners = await db.select({ id: usersTable.id }).from(usersTable)
      .where(eq(usersTable.role, "owner"));
    const amountFormatted = topup.amount.toLocaleString("id-ID");
    for (const ow of owners) {
      await db.insert(notificationsTable).values({
        userId: ow.id,
        title: "Pembayaran Menunggu Verifikasi",
        message: `Top up Rp ${amountFormatted} sudah diklik "Sudah Bayar". Verifikasi dana di e-wallet/rekening Anda, lalu Approve.`,
        type: "info",
        category: "payment",
        referenceType: "topup",
        referenceId: topup.id,
      });
    }
  } catch (e) {
    logger.warn({ err: (e as any)?.message, id }, "topup: mark-paid owner notify failed (best-effort)");
  }

  const [latest] = await db.select().from(topupsTable).where(eq(topupsTable.id, id)).limit(1);
  res.json({ ...(latest ?? topup), status: "awaiting_confirmation", paid: false });
});

// ── POST /topup/:id/cancel — user cancels a pending top-up ────────────────────
router.post("/topup/:id/cancel", authenticate, qrisRateLimit, async (req, res) => {
  const id = String(req.params.id);
  const [topup] = await db.select().from(topupsTable)
    .where(and(eq(topupsTable.id, id), eq(topupsTable.userId, req.user!.userId))).limit(1);
  if (!topup) { res.status(404).json({ error: "Top-up not found" }); return; }

  // Already verified — can never cancel a paid/confirmed top-up.
  if (isPaidStatus(topup.status)) {
    res.status(400).json({ error: "Pembayaran sudah terverifikasi dan tidak dapat dibatalkan." });
    return;
  }
  if (topup.status === "cancelled" || topup.status === "expired" || topup.status === "denied" || topup.status === "failed") {
    res.json({ ...topup, paid: false });
    return;
  }
  if (topup.status !== "pending" && topup.status !== "awaiting_confirmation") {
    res.status(400).json({ error: `Tidak dapat membatalkan top-up berstatus "${topup.status}".` });
    return;
  }

  // Don't cancel a payment the gateway already verified paid.
  try {
    const checked = await getOrder(String(topup.orderId));
    if (isVerifiedGatewayStatus(checked.status)) {
      const result = await creditVerifiedTopup(topup.id, checked.orderId);
      if (result.status === "paid") {
        await invalidateUserCache(topup.userId).catch(() => {});
      }
      res.status(409).json({ error: "Pembayaran sudah terverifikasi dan tidak dapat dibatalkan." });
      return;
    }
  } catch (err) {
    logger.warn({ err: (err as any)?.message, id }, "topup: pre-cancel check failed");
  }

  await cancelOrderAtGateway(topup.orderId);
  const [cancelled] = await db.update(topupsTable)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(topupsTable.id, id), inArray(topupsTable.status, ["pending", "awaiting_confirmation"])))
    .returning();

  res.json({ ...(cancelled ?? topup), status: "cancelled", paid: false });
});

// TemanQRIS calls this after its merchant verification. Only
// payment.confirmed is allowed to credit a wallet.
router.post("/webhooks/temanqris", async (req, res) => {
  const rawBody = (req as any).rawBody as Buffer | undefined;
  const signature = String(req.headers["x-temanqris-signature"] ?? req.headers["x-signature"] ?? "");
  if (!rawBody || !verifyWebhookSignature(rawBody, signature)) {
    res.status(401).json({ error: "Invalid webhook signature" });
    return;
  }

  // TemanQRIS delivers the event name in the X-TemanQRIS-Event header and a
  // retry counter in X-TemanQRIS-Retry (30s -> 2min -> 10min, up to 3 attempts).
  const eventHeader = String(req.headers["x-temanqris-event"] ?? "").toLowerCase();
  const retryHeader = req.headers["x-temanqris-retry"];
  const body: any = req.body ?? {};
  const data: any = body.data ?? body.result ?? body;
  const event = String(eventHeader || body.event || body.type || data.event || data.type || "").toLowerCase();
  if (retryHeader != null) {
    logger.info({ event, retry: String(retryHeader) }, "webhook: temanqris retry received");
  }
  // TemanQRIS reports the payment state both in the X-TemanQRIS-Event header
  // and (redundantly) in `data.status`. A "paid"/"confirmed" status means the
  // QRIS transfer was detected — auto-credit the wallet with no merchant action.
  const dataStatus = String(data.status ?? "").toLowerCase();
  const isAwaiting = event === "payment.awaiting_confirmation" || event === "awaiting_confirmation"
    || dataStatus === "awaiting_confirmation";
  const isConfirmed = event === "payment.confirmed" || event === "payment.paid" || event === "paid"
    || isVerifiedGatewayStatus(dataStatus);
  if (!isAwaiting && !isConfirmed) {
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
  if (!topup) {
    res.json({ received: true, ignored: true });
    return;
  }

  // Confirmed (real payment detected) takes precedence over awaiting — a paid
  // signal always credits, even if an awaiting_confirmation was still in flight.
  if (isConfirmed) {
    const gatewayReference = String(
      data.transaction_id ?? data.transactionId ?? data.reference ?? orderId,
    ).trim();
    const result = await creditVerifiedTopup(topup.id, gatewayReference);
    if (result.status === "paid" || result.status === "already_processed") {
      await invalidateUserCache(topup.userId).catch(() => {});
      await invalidateCache(keys.analytics("overview")).catch(() => {});
    }
    res.json({ received: true, status: result.status });
    return;
  }

  // Customer confirmed payment via the widget — move to awaiting_confirmation
  // so the merchant verifies funds. No wallet credit yet.
  await db.update(topupsTable).set({ status: "awaiting_confirmation", updatedAt: new Date() })
    .where(and(eq(topupsTable.id, topup.id), eq(topupsTable.status, "pending")));
  res.json({ received: true, status: "awaiting_confirmation" });
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
    // The merchant verifies after the customer marks "Sudah Bayar" (awaiting)
    // or while it is still pending. Once paid/confirmed it cannot be redone.
    if (topup.status !== "pending" && topup.status !== "awaiting_confirmation") {
      res.status(400).json({ error: `Cannot confirm: top-up is already "${topup.status}"` }); return;
    }
    if (topup.amountMatchStatus === "mismatch") {
      res.status(400).json({ error: "Cannot confirm: transfer amount does not match selected amount. Please deny this payment." });
      return;
    }

    // "Verify Order" (merchant) — TemanQRIS POST /orders/:orderId/verify marks
    // the gateway order as paid. The owner must have already confirmed the
    // funds landed in their e-wallet/rekening. Best-effort: a gateway error
    // (e.g. already verified) never blocks the owner's own verification.
    if (topup.gateway === "temanqris" && topup.orderId) {
      try {
        const verified = await verifyOrder(String(topup.orderId));
        logger.info({ topupId: id, orderId: topup.orderId, gwStatus: verified.status }, "Topup confirm: gateway Verify Order -> paid");
      } catch (err: any) {
        logger.warn({ err: (err as any)?.message ?? err, topupId: id, orderId: topup.orderId }, "Topup confirm: gateway verify failed (continuing with local verify)");
      }
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
    if (topup.status !== "pending" && topup.status !== "awaiting_confirmation") {
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
