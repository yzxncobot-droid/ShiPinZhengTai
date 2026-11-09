/**
 * Central top-up credit service.
 *
 * SECURITY MODEL:
 * `creditVerifiedTopup()` is the SINGLE function that may add wallet balance
 * for a top-up. No other code path — route or background job — may
 * directly increment wallet balance.
 *
 * Manual Top-Up Flow:
 * - Admin or Owner clicks "Konfirmasi" (Accept) → PATCH /topups/:id/confirm
 *    → creditVerifiedTopup()
 *
 * Anti-double-credit is guaranteed by creditVerifiedTopup() via a Postgres
 * advisory lock + duplicate-reference check, so repeated admin clicks
 * or concurrent calls cannot double-credit.
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

/** Statuses that mean the wallet has already been credited. */
export function isPaidStatus(status: string): boolean {
  return status === "paid" || status === "confirmed";
}

/**
 * Credit a verified top-up exactly once. The topup row and user row are locked
 * inside one DB transaction so repeated admin clicks cannot double-credit.
 * A Postgres advisory lock on the gateway reference serializes concurrent calls
 * even when they point at different local rows.
 *
 * This is the SINGLE wallet-credit function for top-ups. No other code path
 * may add wallet balance for a top-up.
 *
 * @param topupId           - local topup UUID
 * @param gatewayReference  - unique provider reference (`admin-<id>` for manual approval).
 *                            Used for the duplicate-reference guard.
 */
export async function creditVerifiedTopup(
  topupId: string,
  gatewayReference: string,
): Promise<{ status: string; newBalance?: number }> {
  return db.transaction(async (tx: any) => {
    // Serialize all calls for the same gateway reference.
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

    // Duplicate-reference guard — prevents double-credit if the same reference is processed twice.
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
