/**
 * Central TemanQRIS top-up verification service.
 *
 * Root cause of the original bug: when TemanQRIS reported `awaiting_confirmation`
 * (via webhook or status polling) the backend only stored that status and
 * stopped — it never called `verifyOrder()`, so TemanQRIS never verified the
 * order and the wallet was never credited.
 *
 * This module provides the single verification path used by BOTH the webhook
 * (`payment.awaiting_confirmation` / `payment.confirmed`) and the status
 * polling endpoint. It calls `verifyOrder()`, evaluates the real TemanQRIS
 * response, and finalizes (credits) only when TemanQRIS reports paid.
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
import { verifyOrder } from "./temanqris";
import { logger } from "./logger";
import { invalidateUserCache, invalidateCache, keys } from "./redis";

const VERIFY_MAX_ATTEMPTS = 3;
const VERIFY_BACKOFF_MS = 1_000;

function isPaidStatus(status: string): boolean {
  return status === "paid" || status === "confirmed";
}

function isPaidGatewayStatus(status: string): boolean {
  return ["paid", "success", "confirmed", "completed", "settled"].includes(status);
}

export type VerificationOutcome =
  | "paid"
  | "already_paid"
  | "still_awaiting"
  | "expired"
  | "not_found"
  | "not_linked"
  | "amount_mismatch"
  | "verification_failed";

export interface VerificationResult {
  outcome: VerificationOutcome;
  newBalance?: number;
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
    if (String(topup.status) !== "pending") return { status: String(topup.status) };

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
 * Finalize a top-up that TemanQRIS has confirmed as paid (via `payment.confirmed`
 * webhook or a `verifyOrder` paid response). Validates the amount against the
 * database top-up, then credits via the shared `creditVerifiedTopup`.
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

async function invalidateCaches(userId: string): Promise<void> {
  await invalidateUserCache(userId).catch(() => {});
  await invalidateCache(keys.analytics("overview")).catch(() => {});
}

/**
 * Central verification service — the single entry point used by both the
 * TemanQRIS webhook and the status polling endpoint when `awaiting_confirmation`
 * is received.
 *
 * 1. Find the top-up by TemanQRIS order ID.
 * 2. If already paid → return (idempotent).
 * 3. If not linked (no amount) → return (wait for /link).
 * 4. Call `verifyOrder(orderId)` with limited retry on transient failures.
 * 5. Evaluate the REAL TemanQRIS response — never assume success.
 * 6. If paid → validate order ID + amount → `creditVerifiedTopup()`.
 * 7. If still awaiting → stay pending, do NOT credit.
 * 8. If expired → mark expired, do NOT credit.
 */
export async function processAwaitingConfirmation(
  orderId: string,
): Promise<VerificationResult> {
  logger.info({ orderId }, "[TQ] verification started");

  // 1. Find the top-up by TemanQRIS order ID.
  const [topup] = await db.select().from(topupsTable)
    .where(eq(topupsTable.orderId, orderId)).limit(1);

  if (!topup) {
    logger.warn({ orderId }, "[TQ] verification: topup not found by orderId");
    return { outcome: "not_found" };
  }

  // 2. Already paid — nothing to do (idempotent).
  if (isPaidStatus(topup.status)) {
    logger.info({ orderId, topupId: topup.id, status: topup.status }, "[TQ] verification: already paid");
    return { outcome: "already_paid" };
  }

  // 3. Not linked yet (no amount) — can't verify safely. Wait for /link.
  if (!topup.orderId || Number(topup.amount) <= 0) {
    logger.warn({ orderId, topupId: topup.id, amount: topup.amount }, "[TQ] verification: topup not linked (no amount)");
    return { outcome: "not_linked" };
  }

  // 4. Call verifyOrder() with limited retry on transient failures.
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= VERIFY_MAX_ATTEMPTS; attempt++) {
    try {
      logger.info({ orderId, attempt }, "[TQ] verifyOrder started");
      const order = await verifyOrder(orderId);
      logger.info(
        { orderId, attempt, status: order.status, amount: order.amount },
        "[TQ] verifyOrder response",
      );

      // 5. Evaluate the actual TemanQRIS response — never assume success.
      if (isPaidGatewayStatus(order.status)) {
        // 6a. Validate order ID matches.
        if (order.orderId !== orderId) {
          logger.error(
            { orderId, gatewayOrderId: order.orderId },
            "[TQ] verification failed: order ID mismatch",
          );
          return { outcome: "verification_failed" };
        }
        // 6b. Validate amount matches the database top-up.
        if (order.amount != null && order.amount !== Number(topup.amount)) {
          logger.error(
            { orderId, topupId: topup.id, localAmount: topup.amount, gatewayAmount: order.amount },
            "[TQ] Amount mismatch — NOT crediting",
          );
          return { outcome: "amount_mismatch" };
        }
        // 6c. Finalize: credit the wallet exactly once.
        logger.info({ orderId, topupId: topup.id }, "[TQ] credit started");
        const result = await creditVerifiedTopup(topup.id, orderId);
        logger.info(
          { orderId, topupId: topup.id, creditStatus: result.status },
          "[TQ] credit completed",
        );

        if (result.status === "paid" || result.status === "already_processed") {
          await invalidateCaches(topup.userId);
        }
        return { outcome: "paid", newBalance: result.newBalance };
      }

      // 7. Still awaiting — keep pending, do NOT credit.
      if (order.status === "awaiting_confirmation") {
        await db.update(topupsTable).set({
          status: "awaiting_confirmation",
          updatedAt: new Date(),
        }).where(and(
          eq(topupsTable.id, topup.id),
          eq(topupsTable.status, "pending"),
        ));
        logger.info(
          { orderId, topupId: topup.id },
          "[TQ] verification: still awaiting_confirmation, staying pending",
        );
        return { outcome: "still_awaiting" };
      }

      // 8. Expired / cancelled / failed — mark and do NOT credit.
      if (["expired", "cancelled", "failed"].includes(order.status)) {
        await db.update(topupsTable).set({
          status: order.status as any,
          updatedAt: new Date(),
        }).where(and(
          eq(topupsTable.id, topup.id),
          eq(topupsTable.status, "pending"),
        ));
        logger.info(
          { orderId, topupId: topup.id, status: order.status },
          "[TQ] verification: order expired/cancelled/failed",
        );
        return { outcome: "expired" };
      }

      // Unknown status — stay pending, don't credit.
      logger.warn({ orderId, status: order.status }, "[TQ] verification: unknown status, staying pending");
      return { outcome: "still_awaiting" };
    } catch (err: any) {
      lastError = err;
      const code = err?.code ?? "GATEWAY_ERROR";
      logger.warn(
        { orderId, attempt, code, message: err?.message },
        "[TQ] verification failed (attempt), will retry",
      );
      if (attempt < VERIFY_MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, VERIFY_BACKOFF_MS * attempt));
      }
    }
  }

  // All retries exhausted — stay pending, do NOT credit.
  logger.error(
    { orderId, error: String((lastError as any)?.message ?? lastError) },
    "[TQ] verification failed: all retries exhausted, staying pending",
  );
  return { outcome: "verification_failed" };
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
