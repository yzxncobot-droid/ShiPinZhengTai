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

function isPaidStatus(status: string): boolean {
  return status === "paid" || status === "confirmed";
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
