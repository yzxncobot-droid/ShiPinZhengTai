/**
 * Central top-up credit service.
 *
 * SECURITY MODEL:
 * `creditVerifiedTopup()` is the SINGLE function that may add wallet balance
 * for a top-up. No other code path — webhook, route, or background job — may
 * directly increment wallet balance.
 *
 * The ONLY ways a wallet is credited:
 * 1. AUTOMATIC: A valid BuatQris webhook (signature-verified) → processBuatQrisWebhook()
 *    → creditVerifiedTopup()
 * 2. MANUAL: Admin clicks "Konfirmasi" → PATCH /topups/:id/confirm
 *    → creditVerifiedTopup()
 *
 * Anti-double-credit is guaranteed by creditVerifiedTopup() via a Postgres
 * advisory lock + duplicate-reference check, so concurrent webhook
 * deliveries and repeated admin clicks are all safe.
 */
import { db } from "@workspace/db";
import {
  topupsTable,
  usersTable,
  walletsTable,
  walletTransactionsTable,
  transactionsTable,
  notificationsTable,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { logger } from "./logger";
import { invalidateUserCache, invalidateCache, keys } from "./redis";

/** Statuses that mean the wallet has already been credited. */
function isPaidStatus(status: string): boolean {
  return status === "paid" || status === "confirmed";
}

/**
 * Credit a verified top-up exactly once. The topup row and user row are locked
 * inside one DB transaction so repeated webhook deliveries / admin clicks
 * cannot double-credit. A Postgres advisory lock on the gateway reference
 * serializes concurrent calls even when they point at different local rows.
 *
 * This is the SINGLE wallet-credit function for top-ups. No other code path
 * may add wallet balance for a top-up.
 *
 * @param topupId           - local topup UUID
 * @param gatewayReference  - unique provider reference (BuatQris transaction_id
 *                            or `admin-<id>` for manual approval). Used for the
 *                            duplicate-reference guard.
 */
export async function creditVerifiedTopup(
  topupId: string,
  gatewayReference: string,
): Promise<{ status: string; newBalance?: number }> {
  return db.transaction(async (tx: any) => {
    // Serialize all callbacks for the same gateway reference.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${gatewayReference}))`);

    const lockedResult = await tx.execute(sql`
      SELECT id, user_id, amount, status
      FROM topups
      WHERE id = ${topupId}::uuid
      FOR UPDATE
    `);
    const topup = lockedResult.rows[0] as any;
    if (!topup) return { status: "not_found" };

    // Already paid — idempotent success, do NOT credit again.
    if (isPaidStatus(String(topup.status))) return { status: "paid" };

    // Only "pending" (and legacy sub-states awaiting_confirmation /
    // awaiting_manual_review for old rows) may be credited. All other
    // non-pending states (expired, failed, rejected, denied, cancelled) are
    // terminal and must NOT credit.
    const status = String(topup.status);
    if (
      status !== "pending" &&
      status !== "awaiting_confirmation" &&
      status !== "awaiting_manual_review"
    ) {
      return { status };
    }

    // Duplicate-reference guard — prevents double-credit if the same gateway
    // reference is processed twice (e.g. webhook redelivery).
    const duplicate = await tx.select({ id: walletTransactionsTable.id })
      .from(walletTransactionsTable)
      .where(and(
        eq(walletTransactionsTable.referenceType, "topup"),
        eq(walletTransactionsTable.referenceId, gatewayReference),
      ))
      .limit(1);
    if (duplicate.length > 0) {
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
      description: `Top up berhasil: Rp ${amount.toLocaleString("id-ID")}`,
      referenceId: topupId,
    });
    await tx.insert(walletTransactionsTable).values({
      userId: topup.user_id,
      type: "topup",
      amount,
      balanceAfter: after,
      description: `Top up berhasil: Rp ${amount.toLocaleString("id-ID")}`,
      referenceType: "topup",
      referenceId: gatewayReference,
    });
    await tx.insert(notificationsTable).values({
      userId: topup.user_id,
      title: "Top Up Berhasil",
      message: `Top up sebesar Rp ${amount.toLocaleString("id-ID")} berhasil. Saldo kamu sekarang Rp ${after.toLocaleString("id-ID")}.`,
      type: "success",
      category: "payment",
      referenceType: "topup",
      referenceId: topupId,
    });

    logger.info(
      { topupId, userId: topup.user_id, amount, gatewayReference, newBalance: after },
      "creditVerifiedTopup — credit success",
    );
    return { status: "paid", newBalance: after };
  });
}

// ── BuatQris webhook processing ─────────────────────────────────────────────

export interface WebhookProcessResult {
  httpStatus: number;
  body: Record<string, unknown>;
}

/**
 * Process a BuatQris webhook payload (signature already verified by the
 * route handler). Handles payment.success, payment.expired, payment.failed.
 *
 * Idempotency: if the payment is already paid, returns 200 without
 * re-crediting. The advisory lock + duplicate-reference guard in
 * creditVerifiedTopup() handles concurrent deliveries.
 */
export async function processBuatQrisWebhook(payload: any): Promise<WebhookProcessResult> {
  const data = payload?.data ?? payload?.result ?? payload;
  const event = String(payload?.event ?? payload?.type ?? data?.event ?? data?.type ?? "").toLowerCase();
  const transactionId = String(
    data?.transaction_id ?? data?.transactionId ?? data?.trx_id ?? "",
  ).trim();
  const orderId = String(
    data?.order_id ?? data?.orderId ?? data?.merchant_order_id ?? data?.description ?? "",
  ).trim();
  const amount = Number(data?.amount ?? data?.nominal ?? NaN);

  logger.info(
    { event, transactionId, orderId, amount },
    "BuatQris webhook received",
  );

  if (!event) {
    return { httpStatus: 400, body: { error: "Missing event" } };
  }

  // ── payment.success → credit ──────────────────────────────────────────
  if (event === "payment.success") {
    if (!transactionId) {
      logger.warn({ event }, "BuatQris webhook: payment.success missing transaction_id");
      return { httpStatus: 400, body: { error: "Missing transaction_id" } };
    }

    // Find the payment by provider_transaction_id first, then by order_id.
    let topup: any = null;
    if (transactionId) {
      [topup] = await db.select().from(topupsTable)
        .where(eq(topupsTable.providerTransactionId, transactionId)).limit(1);
    }
    if (!topup && orderId) {
      [topup] = await db.select().from(topupsTable)
        .where(eq(topupsTable.orderId, orderId)).limit(1);
    }

    if (!topup) {
      logger.warn({ transactionId, orderId }, "BuatQris webhook: payment not found — not crediting");
      return { httpStatus: 200, body: { received: true, ignored: true, reason: "payment_not_found" } };
    }

    // Validate payment_method is automatic.
    if (topup.paymentMethod !== "automatic") {
      logger.warn(
        { topupId: topup.id, paymentMethod: topup.paymentMethod },
        "BuatQris webhook: payment_method is not automatic — not crediting",
      );
      return { httpStatus: 200, body: { received: true, ignored: true, reason: "wrong_payment_method" } };
    }

    // Already paid — idempotent success.
    if (isPaidStatus(String(topup.status))) {
      logger.info({ topupId: topup.id }, "BuatQris webhook: already paid — idempotent");
      return { httpStatus: 200, body: { received: true, status: "already_paid" } };
    }

    // Validate amount.
    if (Number.isFinite(amount) && amount !== Number(topup.amount)) {
      logger.error(
        { topupId: topup.id, localAmount: topup.amount, webhookAmount: amount },
        "BuatQris webhook: amount mismatch — NOT crediting, marking failed",
      );
      await db.update(topupsTable).set({
        status: "failed",
        callbackReceivedAt: new Date(),
        providerPayload: payload,
        updatedAt: new Date(),
      }).where(eq(topupsTable.id, topup.id));
      return { httpStatus: 200, body: { received: true, status: "amount_mismatch" } };
    }

    // Validate transaction_id matches.
    if (topup.providerTransactionId && topup.providerTransactionId !== transactionId) {
      logger.error(
        { topupId: topup.id, localTxId: topup.providerTransactionId, webhookTxId: transactionId },
        "BuatQris webhook: transaction_id mismatch — NOT crediting",
      );
      return { httpStatus: 200, body: { received: true, status: "transaction_mismatch" } };
    }

    // Credit via the single credit path.
    logger.info({ topupId: topup.id, transactionId }, "BuatQris webhook: crediting");
    const result = await creditVerifiedTopup(topup.id, transactionId);

    // Record callback receipt + raw payload for audit (outside the credit tx).
    await db.update(topupsTable).set({
      callbackReceivedAt: new Date(),
      providerPayload: payload,
      updatedAt: new Date(),
    }).where(eq(topupsTable.id, topup.id));

    if (result.status === "paid" || result.status === "already_processed") {
      await invalidateUserCache(topup.userId).catch(() => {});
      await invalidateCache(keys.analytics("overview")).catch(() => {});
    }

    logger.info({ topupId: topup.id, creditStatus: result.status }, "BuatQris webhook: processed");
    return { httpStatus: 200, body: { received: true, status: result.status } };
  }

  // ── payment.expired → mark expired ────────────────────────────────────
  if (event === "payment.expired") {
    if (!transactionId && !orderId) {
      return { httpStatus: 200, body: { received: true, ignored: true } };
    }
    let topup: any = null;
    if (transactionId) {
      [topup] = await db.select().from(topupsTable)
        .where(eq(topupsTable.providerTransactionId, transactionId)).limit(1);
    }
    if (!topup && orderId) {
      [topup] = await db.select().from(topupsTable)
        .where(eq(topupsTable.orderId, orderId)).limit(1);
    }
    if (topup && !isPaidStatus(String(topup.status)) && topup.status === "pending") {
      await db.update(topupsTable).set({
        status: "expired",
        callbackReceivedAt: new Date(),
        providerPayload: payload,
        updatedAt: new Date(),
      }).where(eq(topupsTable.id, topup.id));
      logger.info({ topupId: topup.id }, "BuatQris webhook: marked expired");
    }
    return { httpStatus: 200, body: { received: true, status: "expired" } };
  }

  // ── payment.failed → mark failed ──────────────────────────────────────
  if (event === "payment.failed") {
    if (!transactionId && !orderId) {
      return { httpStatus: 200, body: { received: true, ignored: true } };
    }
    let topup: any = null;
    if (transactionId) {
      [topup] = await db.select().from(topupsTable)
        .where(eq(topupsTable.providerTransactionId, transactionId)).limit(1);
    }
    if (!topup && orderId) {
      [topup] = await db.select().from(topupsTable)
        .where(eq(topupsTable.orderId, orderId)).limit(1);
    }
    if (topup && !isPaidStatus(String(topup.status)) && topup.status === "pending") {
      await db.update(topupsTable).set({
        status: "failed",
        callbackReceivedAt: new Date(),
        providerPayload: payload,
        updatedAt: new Date(),
      }).where(eq(topupsTable.id, topup.id));
      logger.info({ topupId: topup.id }, "BuatQris webhook: marked failed");
    }
    return { httpStatus: 200, body: { received: true, status: "failed" } };
  }

  // Unknown event — acknowledge but ignore.
  logger.info({ event }, "BuatQris webhook: unknown event — ignoring");
  return { httpStatus: 200, body: { received: true, ignored: true } };
}
