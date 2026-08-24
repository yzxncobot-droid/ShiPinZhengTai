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

/**
 * Polling schedule for the "Sudah Bayar" verification flow.
 * Absolute seconds from the start of verification — matches the spec:
 * 0, 2, 4, 6, 8, 10, 15, 20, 30, 60.
 * Stops after the last attempt; never polls forever.
 */
export const POLL_SCHEDULE_SECONDS = [0, 2, 4, 6, 8, 10, 15, 20, 30, 60];

/** Backward-compatible alias for tests that reference POLL_CONFIG. */
export const POLL_CONFIG = {
  intervalMs: 2000,
  attempts: POLL_SCHEDULE_SECONDS.length,
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
    if (String(topup.status) !== "pending" && String(topup.status) !== "awaiting_confirmation" && String(topup.status) !== "awaiting_manual_review") return { status: String(topup.status) };

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

    logger.info(
      { topupId, userId: topup.user_id, amount, gatewayReference, newBalance: after },
      "[TQ-AUTO] creditVerifiedTopup — credit success",
    );
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
      "[TQ-AUTO] amount mismatch (finalize) — NOT crediting",
    );
    return { status: "amount_mismatch" };
  }

  return creditVerifiedTopup(topup.id, orderId);
}

/**
 * verifyIncomingPayment(topupId) — the core payment-verification service.
 *
 * Reads EVERYTHING from the database (order_id, expected amount, userId,
 * gateway/merchant) — never trusts frontend data. Queries TemanQRIS via the
 * read-only `getOrder()` to check whether the payment has actually been
 * received. Returns a structured result describing whether proof of payment
 * was found.
 *
 * API CAPABILITY NOTE (point 18 of the spec):
 * TemanQRIS does NOT expose a separate incoming-transaction / mutation /
 * settlement API. The only available proof of payment is:
 *   1. `getOrder()` reporting a paid/confirmed status, AND
 *   2. The signed `payment.confirmed` webhook.
 * No endpoint is fabricated. `verifyOrder()` (POST /orders/:id/verify) is
 * NOT called here because `awaiting_confirmation` is NOT proof of payment —
 * it only means the customer pressed "Sudah Bayar". Calling `verifyOrder()`
 * on that basis was the root cause of the free-saldo bug.
 *
 * When `getOrder()` reports "paid", that IS the proof — the QRIS settlement
 * was detected by TemanQRIS. The caller credits via `creditVerifiedTopup()`.
 */
export async function verifyIncomingPayment(
  topupId: string,
): Promise<{
  /** true only when TemanQRIS reports a confirmed payment that matches. */
  found: boolean;
  status: "paid" | "awaiting_confirmation" | "not_found" | "gateway_error" | "expired";
  /** The gateway order_id that was verified (matches the DB order_id). */
  orderId?: string;
  /** The gateway-reported amount (matches the DB amount). */
  amount?: number;
  message?: string;
}> {
  // ── 1. Ambil topup dari database ──────────────────────────────────────
  const [topup] = await db.select().from(topupsTable)
    .where(eq(topupsTable.id, topupId)).limit(1);
  if (!topup) {
    logger.warn({ topupId }, "[TQ-AUTO] verifyIncomingPayment: topup not found");
    return { found: false, status: "not_found", message: "Topup not found" };
  }

  // ── 2. Ambil order_id dari database ───────────────────────────────────
  if (!topup.orderId) {
    logger.warn({ topupId }, "[TQ-AUTO] verifyIncomingPayment: no order_id");
    return { found: false, status: "not_found", message: "No order_id" };
  }

  // ── 3. Ambil expected amount dari database ─────────────────────────────
  const expectedAmount = Number(topup.amount);
  if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) {
    logger.warn({ topupId, amount: topup.amount }, "[TQ-AUTO] verifyIncomingPayment: invalid amount");
    return { found: false, status: "not_found", message: "Invalid amount" };
  }

  // ── 4. Check expiry ────────────────────────────────────────────────────
  if (topup.expiredAt && new Date(topup.expiredAt).getTime() <= Date.now()) {
    logger.info({ topupId, orderId: topup.orderId }, "[TQ-AUTO] verifyIncomingPayment: topup expired");
    return { found: false, status: "expired", message: "Topup expired" };
  }

  // ── 5. Already paid — idempotent success ──────────────────────────────
  if (isPaidStatus(String(topup.status))) {
    return { found: true, status: "paid", orderId: topup.orderId, amount: expectedAmount };
  }

  // ── 6. Terminal non-pending states — cannot verify ─────────────────────
  if (["expired", "failed", "cancelled", "denied"].includes(String(topup.status))) {
    return { found: false, status: "expired", message: `Topup is ${topup.status}` };
  }

  // ── 7. Gateway not configured — cannot verify ─────────────────────────
  if (getGatewayState() !== "CONNECTED") {
    logger.warn({ topupId }, "[TQ-AUTO] verifyIncomingPayment: gateway not configured");
    return { found: false, status: "gateway_error", message: "Gateway not configured" };
  }

  // ── 8. Cari transaksi pembayaran masuk via getOrder() ──────────────────
  logger.info({ topupId, orderId: topup.orderId, expectedAmount }, "[TQ-AUTO] checking incoming payment");
  try {
    const order = await getOrder(String(topup.orderId));

    // ── 8a. Cocokkan order_id ───────────────────────────────────────────
    if (order.orderId !== topup.orderId) {
      logger.warn(
        { topupId, localOrderId: topup.orderId, gatewayOrderId: order.orderId },
        "[TQ-AUTO] order mismatch — rejecting",
      );
      return { found: false, status: "not_found", message: "Order ID mismatch" };
    }

    // ── 8b. Cocokkan amount ─────────────────────────────────────────────
    if (order.amount != null && Number.isFinite(order.amount) && order.amount !== expectedAmount) {
      logger.warn(
        { topupId, localAmount: expectedAmount, gatewayAmount: order.amount },
        "[TQ-AUTO] amount mismatch — rejecting",
      );
      return { found: false, status: "not_found", message: "Amount mismatch" };
    }

    // ── 8c. Check payment status ─────────────────────────────────────────
    if (CONFIRMED_STATUSES.includes(order.status)) {
      logger.info(
        { topupId, orderId: order.orderId, amount: order.amount },
        "[TQ-AUTO] transaction found — payment confirmed",
      );
      return { found: true, status: "paid", orderId: order.orderId, amount: order.amount ?? expectedAmount };
    }

    // awaiting_confirmation or pending — payment not yet confirmed
    logger.info(
      { topupId, orderId: topup.orderId, gatewayStatus: order.status },
      "[TQ-AUTO] transaction not yet confirmed (status: {status})",
    );
    return { found: false, status: "awaiting_confirmation", orderId: topup.orderId, message: `Gateway status: ${order.status}` };
  } catch (err) {
    logger.warn(
      { topupId, orderId: topup.orderId, err: (err as any)?.message },
      "[TQ-AUTO] getOrder failed during incoming payment check",
    );
    return { found: false, status: "gateway_error", message: (err as any)?.message ?? "Gateway error" };
  }
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
      "[TQ-AUTO] user mismatch — NOT crediting",
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
  logger.info({ topupId, userId: authenticatedUserId }, "[TQ-AUTO] customer confirmation");
  const linkCode = extractLinkCode(topup.paymentLink);
  if (linkCode) {
    try {
      await confirmCustomerPayment(linkCode);
      logger.info({ topupId, linkCode }, "[TQ-AUTO] confirmCustomerPayment triggered");
    } catch (err) {
      logger.warn({ topupId, err: (err as any)?.message }, "[TQ-AUTO] confirmCustomerPayment failed — continuing to poll");
    }
  }

  // ── 8. Poll verifyIncomingPayment() on the spec schedule ──────────────
  // Schedule (absolute seconds): 0, 2, 4, 6, 8, 10, 15, 20, 30, 60.
  // Stops after the last attempt — never polls forever. Only a confirmed
  // payment with matching order_id + amount triggers credit.
  // awaiting_confirmation is NEVER treated as paid.
  let hadGatewayError = false;
  let prevSecond = 0;

  for (let attempt = 0; attempt < POLL_SCHEDULE_SECONDS.length; attempt++) {
    const delayMs = Math.max(0, (POLL_SCHEDULE_SECONDS[attempt] - prevSecond) * 1000);
    if (attempt > 0) await sleep(delayMs);
    prevSecond = POLL_SCHEDULE_SECONDS[attempt];

    const result = await verifyIncomingPayment(topupId);

    if (result.status === "gateway_error") {
      hadGatewayError = true;
      continue;
    }
    if (result.status === "expired" || result.status === "not_found") {
      // expired = topup expired/terminal; not_found = order_id or amount
      // mismatch — both are permanent failures, not "keep polling".
      return { success: false, status: "verification_failed", message: "Pembayaran tidak dapat diverifikasi." };
    }
    if (!result.found || result.status !== "paid") {
      continue; // still awaiting_confirmation — keep polling
    }

    // ── 8a. Payment proven — credit via the single credit path ─────────
    logger.info({ topupId, orderId: result.orderId }, "[TQ-AUTO] TemanQRIS verification started");
    const creditResult = await creditVerifiedTopup(topupId, String(result.orderId));

    if (creditResult.status === "paid") {
      logger.info({ topupId, orderId: result.orderId }, "[TQ-AUTO] credit success");
      await invalidateUserCache(topup.userId).catch(() => {});
      await invalidateCache(keys.analytics("overview")).catch(() => {});
      return { success: true, status: "paid", message: "Pembayaran berhasil diverifikasi.", amount: Number(topup.amount), newBalance: creditResult.newBalance };
    }
    if (creditResult.status === "already_processed") {
      logger.info({ topupId, orderId: result.orderId }, "[TQ-AUTO] credit success (already processed)");
      return { success: true, status: "paid", message: "Pembayaran berhasil diverifikasi.", amount: Number(topup.amount) };
    }

    // creditVerifiedTopup returned a non-credit state — don't claim success
    return { success: false, status: "verification_failed", message: "Pembayaran tidak dapat diverifikasi." };
  }

  // ── 9. Still not confirmed after all polling attempts ───────────────────
  // The background job will continue checking after this request ends, so
  // the process is NOT lost when the user closes the browser.
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
    message: "Pembayaran belum terdeteksi. Jika kamu sudah membayar, sistem akan terus memproses pembayaran setelah transaksi terkonfirmasi.",
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
    "[TQ-AUTO] webhook linked pending topup with order_id",
  );
  return pendingTopup.id;
}
