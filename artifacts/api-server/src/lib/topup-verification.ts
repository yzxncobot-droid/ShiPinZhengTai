/**
 * Central TemanQRIS top-up verification service.
 *
 * SECURITY MODEL (fix for free-saldo bug):
 * `awaiting_confirmation` is NEVER treated as proof of payment. The backend
 * must NEVER call `verifyOrder()` (POST /orders/{id}/verify) automatically —
 * that endpoint performs merchant confirmation which can mark an order as
 * "paid" without the customer actually paying, which was the root cause of
 * the free-saldo bug.
 *
 * The ONLY ways a wallet is credited:
 * 1. A valid `payment.confirmed` webhook (signature-verified) → creditVerifiedTopup()
 * 2. Read-only `getOrder()` polling that reports "paid" → finalizeVerifiedTopup()
 *    → creditVerifiedTopup()
 *
 * `awaiting_confirmation` always stays pending. No fallback, no auto-verify,
 * no polling-based status change from awaiting_confirmation → paid.
 *
 * Anti-double-credit is handled by `creditVerifiedTopup()` via a Postgres
 * advisory lock + duplicate-reference check, so concurrent webhook, polling,
 * and retry calls are all safe.
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
import { eq, and, sql, desc } from "drizzle-orm";
import { logger } from "./logger";
import { invalidateUserCache, invalidateCache, keys } from "./redis";
import { getOrder, getGatewayState, confirmCustomerPayment } from "./temanqris";

function isPaidStatus(status: string): boolean {
  return status === "paid" || status === "confirmed";
}

/** Polling configuration for the "Sudah Bayar" verification flow. */
export const POLL_CONFIG = {
  /** Delay between polling attempts (ms). */
  intervalMs: 2000,
  /** Number of getOrder() attempts before giving up. */
  attempts: 6,
};

const CONFIRMED_STATUSES = ["paid", "success", "confirmed", "completed", "settled"];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Extract the TemanQRIS link code from a payment-link URL. */
function extractLinkCode(paymentLink: string | null): string | null {
  if (!paymentLink) return null;
  const match = paymentLink.match(/temanqris\.com\/p\/([^/?#]+)/);
  return match ? match[1] : null;
}

/**
 * Extract the user UUID from a TemanQRIS widget description string.
 * The frontend widget sets `data-description="Top Up Wallet user:<uuid>"`.
 */
export function extractUserIdFromDescription(description: string): string | null {
  const match = description.match(
    /user:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/,
  );
  return match ? match[1] : null;
}

/**
 * Credit a verified gateway mutation exactly once. The topup row and user row
 * are locked inside one DB transaction so repeated polling/webhooks cannot
 * double-credit. A Postgres advisory lock on the gateway reference serializes
 * concurrent calls even when they point at different local rows.
 *
 * This is the SINGLE wallet-credit function for QRIS top-ups. No other code
 * path may add wallet balance for a top-up.
 */
export async function creditVerifiedTopup(
  topupId: string,
  gatewayReference: string,
): Promise<{ status: string; newBalance?: number }> {
  return db.transaction(async (tx: any) => {
    // Serialize all callbacks/polls for the same gateway mutation, even when
    // they point at different local rows.
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
    // awaiting_confirmation is a sub-state of pending — the payment hasn't
    // been credited yet, so a valid payment.confirmed webhook (or getOrder()
    // reporting paid) can still credit it. All other non-pending states
    // (expired, cancelled, failed, denied) are terminal and must NOT credit.
    if (String(topup.status) !== "pending" && String(topup.status) !== "awaiting_confirmation") return { status: String(topup.status) };

    const duplicate = await tx.select({ id: walletTransactionsTable.id })
      .from(walletTransactionsTable)
      .where(and(
        eq(walletTransactionsTable.referenceType, "topup"),
        eq(walletTransactionsTable.referenceId, gatewayReference),
      ))
      .limit(1);
    if (duplicate.length > 0) {
      // The mutation was already assigned to another top-up.
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

/**
 * Finalize a top-up that TemanQRIS has confirmed as paid (via a valid
 * `payment.confirmed` webhook or a read-only `getOrder()` that reports paid).
 * Validates the amount against the database top-up, then credits via the
 * shared `creditVerifiedTopup`.
 */
export async function finalizeVerifiedTopup(
  orderId: string,
  gatewayAmount?: number,
): Promise<{ status: string; newBalance?: number }> {
  const [topup] = await db.select().from(topupsTable)
    .where(eq(topupsTable.orderId, orderId)).limit(1);
  if (!topup) return { status: "not_found" };
  if (isPaidStatus(topup.status)) return { status: "paid" };

  if (
    gatewayAmount != null &&
    Number.isFinite(gatewayAmount) &&
    gatewayAmount !== Number(topup.amount)
  ) {
    logger.error(
      { orderId, topupId: topup.id, localAmount: topup.amount, gatewayAmount },
      "[TQ] Amount mismatch (finalize) — NOT crediting",
    );
    return { status: "amount_mismatch" };
  }

  return creditVerifiedTopup(topup.id, orderId);
}

/**
 * Full "Sudah Bayar" verification flow for an authenticated user.
 *
 * This is the ONLY entry point triggered by the user pressing "Sudah Bayar".
 * It:
 *  1. Validates the topup belongs to the authenticated user (never trusts
 *     a user_id from the frontend).
 *  2. Confirms the topup is not already paid / in a terminal state.
 *  3. Sets the local status to `awaiting_confirmation` — this is NOT proof of
 *     payment; it only records that the user pressed the button.
 *  4. Queries TemanQRIS via the read-only `getOrder()` to check whether the
 *     payment has ACTUALLY been received.
 *  5. Only if getOrder() reports a paid/confirmed status AND order_id matches
 *     AND amount matches, calls `creditVerifiedTopup()` — the single credit
 *     function.
 *  6. Returns a structured response the frontend maps to one of three states:
 *     paid / awaiting_payment / verification_failed.
 *
 * `awaiting_confirmation` is NEVER treated as payment success. If getOrder()
 * does not report a confirmed status, no credit happens.
 */
export async function verifyAndCreditTopup(
  topupId: string,
  authenticatedUserId: string,
): Promise<{
  success: boolean;
  status: "paid" | "awaiting_payment" | "verification_failed";
  message: string;
  /** Distinguishes pending payment from gateway/system errors so the
   * frontend can show the correct message instead of always saying
   * "belum terdeteksi". */
  errorType?: "pending" | "system_error" | "gateway_error";
  amount?: number;
  newBalance?: number;
}> {
  // ── 1. Find the topup ──────────────────────────────────────────────────
  const [topup] = await db.select().from(topupsTable)
    .where(eq(topupsTable.id, topupId)).limit(1);
  if (!topup) {
    return { success: false, status: "verification_failed", message: "Pembayaran tidak dapat diverifikasi." };
  }

  // ── 2. Validate ownership — never trust a frontend user_id ────────────
  if (topup.userId !== authenticatedUserId) {
    logger.warn(
      { topupId, topupUserId: topup.userId, requesterId: authenticatedUserId },
      "[TQ] confirm-paid: user mismatch — NOT crediting",
    );
    return { success: false, status: "verification_failed", message: "Pembayaran tidak dapat diverifikasi." };
  }

  // ── 3. Already paid — return success without re-crediting (idempotent) ─
  if (isPaidStatus(topup.status)) {
    return { success: true, status: "paid", message: "Pembayaran berhasil diverifikasi.", amount: Number(topup.amount) };
  }

  // ── 4. Terminal non-pending states — cannot verify ─────────────────────
  if (["expired", "failed", "cancelled", "denied"].includes(topup.status)) {
    return { success: false, status: "verification_failed", message: "Pembayaran tidak dapat diverifikasi." };
  }

  // ── 5. Set status to awaiting_confirmation (NOT proof of payment) ──────
  if (topup.status === "pending") {
    await db.update(topupsTable).set({
      status: "awaiting_confirmation",
      updatedAt: new Date(),
    }).where(eq(topupsTable.id, topupId));
  }

  // ── 6. Gateway not configured — cannot verify ─────────────────────────
  if (!topup.orderId || getGatewayState() !== "CONNECTED") {
    return {
      success: false,
      status: "awaiting_payment",
      message: "Pembayaran belum terdeteksi. Pastikan pembayaran QRIS sudah berhasil.",
      errorType: "pending",
    };
  }

  // ── 7. Trigger customer confirmation on TemanQRIS ──────────────────────
  // Tell TemanQRIS the customer pressed "Sudah Bayar". This marks the order
  // as awaiting_confirmation on their side — it is NOT proof of payment.
  const linkCode = extractLinkCode(topup.paymentLink);
  if (linkCode) {
    try {
      await confirmCustomerPayment(linkCode);
      logger.info({ topupId, linkCode }, "[TQ] confirmCustomerPayment triggered");
    } catch (err) {
      logger.warn({ topupId, err: (err as any)?.message }, "[TQ] confirmCustomerPayment failed — continuing to poll");
    }
  }

  // ── 8. Poll getOrder() for actual payment confirmation ─────────────────
  // Check every POLL_CONFIG.intervalMs for up to POLL_CONFIG.attempts times.
  // This gives TemanQRIS time to detect and confirm the QRIS payment. Only
  // a paid/confirmed status with matching order_id + amount triggers credit.
  // awaiting_confirmation is NEVER treated as paid.
  let hadGatewayError = false;

  for (let attempt = 0; attempt < POLL_CONFIG.attempts; attempt++) {
    if (attempt > 0) await sleep(POLL_CONFIG.intervalMs);
    try {
      const order = await getOrder(String(topup.orderId));
      const confirmed = CONFIRMED_STATUSES.includes(order.status);

      if (!confirmed) continue; // still pending/awaiting — keep polling

      // ── 8a. Validate order_id match ──────────────────────────────────
      if (order.orderId !== topup.orderId) {
        logger.error(
          { topupId, localOrderId: topup.orderId, gatewayOrderId: order.orderId },
          "[TQ] confirm-paid: order_id mismatch — NOT crediting",
        );
        return { success: false, status: "verification_failed", message: "Pembayaran tidak dapat diverifikasi." };
      }

      // ── 8b. Validate amount match ─────────────────────────────────────
      if (order.amount != null && Number.isFinite(order.amount) && order.amount !== Number(topup.amount)) {
        logger.error(
          { topupId, localAmount: topup.amount, gatewayAmount: order.amount },
          "[TQ] confirm-paid: amount mismatch — NOT crediting",
        );
        return { success: false, status: "verification_failed", message: "Pembayaran tidak dapat diverifikasi." };
      }

      // ── 8c. All validations passed — credit via the single credit path
      const result = await creditVerifiedTopup(topupId, String(topup.orderId));

      if (result.status === "paid") {
        await invalidateUserCache(topup.userId).catch(() => {});
        await invalidateCache(keys.analytics("overview")).catch(() => {});
        return { success: true, status: "paid", message: "Pembayaran berhasil diverifikasi.", amount: Number(topup.amount), newBalance: result.newBalance };
      }
      if (result.status === "already_processed") {
        return { success: true, status: "paid", message: "Pembayaran berhasil diverifikasi.", amount: Number(topup.amount) };
      }

      // creditVerifiedTopup returned a non-credit state — don't claim success
      return { success: false, status: "verification_failed", message: "Pembayaran tidak dapat diverifikasi." };
    } catch (err) {
      hadGatewayError = true;
      logger.warn({ topupId, attempt, err: (err as any)?.message }, "[TQ] confirm-paid: getOrder failed during poll");
    }
  }

  // ── 9. Still not confirmed after all polling attempts ───────────────────
  if (hadGatewayError) {
    return {
      success: false,
      status: "awaiting_payment",
      message: "Terjadi kesalahan sistem. Silakan coba lagi.",
      errorType: "system_error",
    };
  }
  return {
    success: false,
    status: "awaiting_payment",
    message: "Pembayaran belum terdeteksi. Pastikan pembayaran QRIS sudah berhasil.",
    errorType: "pending",
  };
}

/**
 * Link a pending widget-based top-up with a TemanQRIS order when the webhook
 * arrives before the frontend calls `/topup/:id/link`. Finds the user from the
 * widget description, then the most recent pending top-up for that user, and
 * sets the order ID + amount. Returns the top-up ID if linked, null otherwise.
 */
export async function linkPendingWidgetTopup(
  orderId: string,
  description: string,
  amount: number,
): Promise<string | null> {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const userId = extractUserIdFromDescription(description);
  if (!userId) return null;

  const [pendingTopup] = await db.select().from(topupsTable)
    .where(and(eq(topupsTable.userId, userId), eq(topupsTable.status, "pending")))
    .orderBy(desc(topupsTable.createdAt))
    .limit(1);
  if (!pendingTopup) return null;

  await db.update(topupsTable).set({
    orderId,
    amount,
    updatedAt: new Date(),
  }).where(eq(topupsTable.id, pendingTopup.id));

  logger.info(
    { topupId: pendingTopup.id, orderId, userId, amount },
    "[TQ] webhook linked pending topup with order_id",
  );
  return pendingTopup.id;
}
