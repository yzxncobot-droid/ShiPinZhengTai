/**
 * Background top-up verification job.
 *
 * Ensures the payment-verification process continues even when the user
 * closes the browser, refreshes, or loses connectivity. Periodically scans
 * for top-ups in `awaiting_confirmation` / `pending` state that have an
 * order_id and a non-zero amount, then calls `verifyIncomingPayment()` for
 * each. When a confirmed payment is found, credits via the single
 * `creditVerifiedTopup()` path.
 *
 * This is a fallback to the primary mechanism (the signed
 * `payment.confirmed` webhook). It does NOT replace webhooks — it only covers
 * the case where a webhook is delayed, not configured, or lost.
 *
 * Anti-double-credit is guaranteed by `creditVerifiedTopup()` (advisory lock
 * + duplicate-reference check), so concurrent webhook + background-job calls
 * are safe.
 */
import { db } from "@workspace/db";
import { topupsTable } from "@workspace/db";
import { eq, or, and, sql, desc } from "drizzle-orm";
import { logger } from "./logger";
import { invalidateUserCache, invalidateCache, keys } from "./redis";
import { verifyIncomingPayment, creditVerifiedTopup } from "./topup-verification";

/** How often the background scanner runs (ms). */
const SCAN_INTERVAL_MS = 10_000;

/** Only process top-ups created within this window (ms) to avoid scanning
 *  ancient rows. 20 minutes covers the 15-minute QRIS expiry plus a margin. */
const MAX_AGE_MS = 20 * 60 * 1000;

let scanTimer: ReturnType<typeof setInterval> | null = null;
let scanning = false;

/**
 * Scan once: find all active (pending / awaiting_confirmation) top-ups with
 * an order_id and amount > 0, created recently, and verify each.
 */
async function scanOnce(): Promise<void> {
  if (scanning) return; // prevent overlap
  scanning = true;
  try {
    const cutoff = new Date(Date.now() - MAX_AGE_MS);
    // Fetch top-ups that are pending or awaiting_confirmation, have an
    // order_id, and were created recently. We use raw SQL via drizzle's
    // query builder for the OR condition.
    const topups = await db
      .select({
        id: topupsTable.id,
        userId: topupsTable.userId,
        orderId: topupsTable.orderId,
        amount: topupsTable.amount,
        status: topupsTable.status,
        expiredAt: topupsTable.expiredAt,
      })
      .from(topupsTable)
      .where(
        and(
          or(
            eq(topupsTable.status, "pending" as any),
            eq(topupsTable.status, "awaiting_confirmation" as any),
          ),
          sql`${topupsTable.orderId} IS NOT NULL`,
          sql`${topupsTable.amount} > 0`,
          sql`${topupsTable.createdAt} >= ${cutoff}`,
        ),
      )
      .orderBy(desc(topupsTable.createdAt))
      .limit(50);

    if (topups.length === 0) return;

    logger.info({ count: topups.length }, "[TQ-AUTO] background scan: processing topups");

    await Promise.all(
      topups.map(async (topup) => {
        try {
          const result = await verifyIncomingPayment(topup.id);

          if (!result.found || result.status !== "paid") {
            return; // still awaiting — will be retried next scan
          }

          logger.info(
            { topupId: topup.id, orderId: result.orderId },
            "[TQ-AUTO] background: payment confirmed — crediting",
          );

          const creditResult = await creditVerifiedTopup(
            topup.id,
            String(result.orderId),
          );

          if (
            creditResult.status === "paid" ||
            creditResult.status === "already_processed"
          ) {
            await invalidateUserCache(topup.userId).catch(() => {});
            await invalidateCache(keys.analytics("overview")).catch(() => {});
            logger.info(
              { topupId: topup.id, creditStatus: creditResult.status },
              "[TQ-AUTO] background: credit success",
            );
          }
        } catch (err) {
          logger.warn(
            { topupId: topup.id, err: (err as any)?.message },
            "[TQ-AUTO] background: verifyIncomingPayment error",
          );
        }
      }),
    );
  } catch (err) {
    logger.warn({ err: (err as any)?.message }, "[TQ-AUTO] background scan error");
  } finally {
    scanning = false;
  }
}

/**
 * Start the background verification scanner. Call once on server startup.
 * Safe to call multiple times — only one timer is ever active.
 */
export function startTopupBackgroundVerification(): void {
  if (scanTimer) return;
  logger.info(
    { intervalMs: SCAN_INTERVAL_MS },
    "[TQ-AUTO] background verification job started",
  );
  // Run an initial scan shortly after startup (let the server settle).
  setTimeout(() => scanOnce().catch(() => {}), 5_000);
  scanTimer = setInterval(() => {
    scanOnce().catch(() => {});
  }, SCAN_INTERVAL_MS);
}

/** Stop the background scanner (mainly for tests). */
export function stopTopupBackgroundVerification(): void {
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
}
