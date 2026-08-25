/**
 * Revenue Sharing API
 *
 * Creator / Verified Creator:
 *   GET /revenue/summary          — own earnings summary
 *   GET /revenue/earnings         — paginated per-transaction earnings
 *   GET /revenue/payouts          — payout history
 *
 * Admin / Owner:
 *   GET  /revenue/admin/summary      — platform-wide revenue overview
 *   GET  /revenue/admin/creators     — per-creator earnings breakdown
 *   GET  /revenue/admin/transactions — all revenue share transactions (paginated)
 *   PATCH /revenue/admin/payouts/:id — mark a revenue_share row as paid
 */

import { Router } from "express";
import { db } from "@workspace/db";
import {
  revenueSharesTable,
  usersTable,
  videosTable,
  videoPurchasesTable,
  walletsTable,
  walletTransactionsTable,
  transactionsTable,
} from "@workspace/db";
import {
  eq, desc, sum, count, and, ne, isNotNull, sql, or, ilike,
} from "drizzle-orm";
import { authenticate, requireRole } from "../middlewares/auth";
import { logger } from "../lib/logger";

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// CREATOR ENDPOINTS
// Available to: creator, verified_creator, admin, owner
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /revenue/summary
 * Returns a creator's own earnings summary:
 *   - totalEarned        (sum of all creator_share)
 *   - platformKept       (sum of all platform_share)
 *   - totalTransactions  (count of purchases)
 *   - pendingPayout      (sum of creator_share where payout_status = pending)
 *   - paidOut            (sum of creator_share where payout_status = paid)
 *   - byVideo            (per-video breakdown: title, price, purchases, totalEarned)
 */
router.get(
  "/revenue/summary",
  authenticate,
  requireRole("creator", "verified_creator", "admin", "owner"),
  async (req, res) => {
    const creatorId = req.user!.userId;

    try {
      // Aggregate totals — exclude cancelled rows (those were reversed)
      const [totals] = await db
        .select({
          totalEarned: sum(revenueSharesTable.creatorShare),
          platformKept: sum(revenueSharesTable.platformShare),
          totalTransactions: count(),
        })
        .from(revenueSharesTable)
        .where(
          and(
            eq(revenueSharesTable.creatorId, creatorId),
            ne(revenueSharesTable.payoutStatus, "cancelled"),
          ),
        );

      // Paid breakdown (pending is kept for backward compat but all rows are paid at insert)
      const [paid] = await db
        .select({ paidOut: sum(revenueSharesTable.creatorShare) })
        .from(revenueSharesTable)
        .where(
          and(
            eq(revenueSharesTable.creatorId, creatorId),
            eq(revenueSharesTable.payoutStatus, "paid"),
          ),
        );

      // Per-video breakdown — exclude cancelled
      const byVideo = await db
        .select({
          videoId: revenueSharesTable.videoId,
          videoTitle: videosTable.title,
          videoPrice: revenueSharesTable.videoPrice,
          shareRate: revenueSharesTable.shareRate,
          totalPurchases: count(),
          totalEarned: sum(revenueSharesTable.creatorShare),
          totalPlatformShare: sum(revenueSharesTable.platformShare),
        })
        .from(revenueSharesTable)
        .leftJoin(videosTable, eq(revenueSharesTable.videoId, videosTable.id))
        .where(
          and(
            eq(revenueSharesTable.creatorId, creatorId),
            ne(revenueSharesTable.payoutStatus, "cancelled"),
          ),
        )
        .groupBy(
          revenueSharesTable.videoId,
          videosTable.title,
          revenueSharesTable.videoPrice,
          revenueSharesTable.shareRate,
        )
        .orderBy(desc(sum(revenueSharesTable.creatorShare)));

      res.json({
        totalEarned: Number(totals?.totalEarned) || 0,
        platformKept: Number(totals?.platformKept) || 0,
        totalTransactions: Number(totals?.totalTransactions) || 0,
        paidOut: Number(paid?.paidOut) || 0,
        byVideo: byVideo.map((v: any) => ({
          videoId: v.videoId,
          videoTitle: v.videoTitle,
          videoPrice: Number(v.videoPrice) || 0,
          shareRate: Number(v.shareRate) || 0,
          sharePercent: Math.round((Number(v.shareRate) || 0) * 100),
          totalPurchases: Number(v.totalPurchases) || 0,
          totalEarned: Number(v.totalEarned) || 0,
          totalPlatformShare: Number(v.totalPlatformShare) || 0,
        })),
      });
    } catch (err) {
      logger.error({ err }, "GET /revenue/summary failed");
      res.status(500).json({ error: "Failed to fetch revenue summary" });
    }
  },
);

/**
 * GET /revenue/earnings?page=1&limit=20&videoId=<uuid>
 * Paginated list of per-transaction earnings for the authenticated creator.
 * Each row represents one video sale.
 */
router.get(
  "/revenue/earnings",
  authenticate,
  requireRole("creator", "verified_creator", "admin", "owner"),
  async (req, res) => {
    const creatorId = req.user!.userId;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;
    const filterVideoId = req.query.videoId as string | undefined;

    try {
      const conditions = [eq(revenueSharesTable.creatorId, creatorId)];
      if (filterVideoId) conditions.push(eq(revenueSharesTable.videoId, filterVideoId));

      const [{ total }] = await db
        .select({ total: count() })
        .from(revenueSharesTable)
        .where(and(...conditions));

      const rows = await db
        .select({
          id: revenueSharesTable.id,
          videoId: revenueSharesTable.videoId,
          videoTitle: videosTable.title,
          videoPrice: revenueSharesTable.videoPrice,
          creatorShare: revenueSharesTable.creatorShare,
          platformShare: revenueSharesTable.platformShare,
          shareRate: revenueSharesTable.shareRate,
          creatorRole: revenueSharesTable.creatorRole,
          payoutStatus: revenueSharesTable.payoutStatus,
          payoutDate: revenueSharesTable.payoutDate,
          purchasedAt: revenueSharesTable.createdAt,
          buyer: {
            id: usersTable.id,
            username: usersTable.username,
          },
        })
        .from(revenueSharesTable)
        .leftJoin(videosTable, eq(revenueSharesTable.videoId, videosTable.id))
        .innerJoin(usersTable, eq(revenueSharesTable.buyerId, usersTable.id))
        .where(and(...conditions))
        .orderBy(desc(revenueSharesTable.createdAt))
        .limit(limit)
        .offset(offset);

      res.json({
        data: rows.map((r: any) => ({
          ...r,
          sharePercent: Math.round((Number(r.shareRate) || 0) * 100),
        })),
        pagination: {
          page,
          limit,
          total: Number(total) || 0,
          totalPages: Math.ceil((Number(total) || 0) / limit),
        },
      });
    } catch (err) {
      logger.error({ err }, "GET /revenue/earnings failed");
      res.status(500).json({ error: "Failed to fetch earnings" });
    }
  },
);

/**
 * GET /revenue/payouts?page=1&limit=20
 * Creator's payout history — shows paid revenue_share rows sorted by payout date.
 */
router.get(
  "/revenue/payouts",
  authenticate,
  requireRole("creator", "verified_creator", "admin", "owner"),
  async (req, res) => {
    const creatorId = req.user!.userId;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    try {
      const [{ total }] = await db
        .select({ total: count() })
        .from(revenueSharesTable)
        .where(
          and(
            eq(revenueSharesTable.creatorId, creatorId),
            eq(revenueSharesTable.payoutStatus, "paid"),
          ),
        );

      const rows = await db
        .select({
          id: revenueSharesTable.id,
          videoId: revenueSharesTable.videoId,
          videoTitle: videosTable.title,
          videoPrice: revenueSharesTable.videoPrice,
          creatorShare: revenueSharesTable.creatorShare,
          shareRate: revenueSharesTable.shareRate,
          payoutStatus: revenueSharesTable.payoutStatus,
          payoutDate: revenueSharesTable.payoutDate,
          purchasedAt: revenueSharesTable.createdAt,
        })
        .from(revenueSharesTable)
        .leftJoin(videosTable, eq(revenueSharesTable.videoId, videosTable.id))
        .where(
          and(
            eq(revenueSharesTable.creatorId, creatorId),
            eq(revenueSharesTable.payoutStatus, "paid"),
          ),
        )
        .orderBy(desc(revenueSharesTable.payoutDate))
        .limit(limit)
        .offset(offset);

      res.json({
        data: rows,
        pagination: {
          page,
          limit,
          total: Number(total) || 0,
          totalPages: Math.ceil((Number(total) || 0) / limit),
        },
      });
    } catch (err) {
      logger.error({ err }, "GET /revenue/payouts failed");
      res.status(500).json({ error: "Failed to fetch payout history" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN / OWNER ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /revenue/admin/summary
 * Platform-wide revenue overview:
 *   - totalVideoRevenue     (sum of all video_price — total gross from video sales)
 *   - totalCreatorPayouts   (sum of all creator_share)
 *   - totalPlatformRevenue  (sum of all platform_share)
 *   - totalTransactions     (count of all revenue_share rows)
 *   - pendingPayouts        (sum of creator_share where status = pending)
 */
router.get(
  "/revenue/admin/summary",
  authenticate,
  requireRole("admin", "owner"),
  async (_req, res) => {
    try {
      // Exclude cancelled rows from totals — they represent reversed transactions
      const [totals] = await db
        .select({
          totalVideoRevenue: sum(revenueSharesTable.videoPrice),
          totalCreatorPayouts: sum(revenueSharesTable.creatorShare),
          totalPlatformRevenue: sum(revenueSharesTable.platformShare),
          totalTransactions: count(),
        })
        .from(revenueSharesTable)
        .where(ne(revenueSharesTable.payoutStatus, "cancelled"));

      const [cancelled] = await db
        .select({ cancelledAmount: sum(revenueSharesTable.creatorShare) })
        .from(revenueSharesTable)
        .where(eq(revenueSharesTable.payoutStatus, "cancelled"));

      res.json({
        totalVideoRevenue: Number(totals?.totalVideoRevenue) || 0,
        totalCreatorPayouts: Number(totals?.totalCreatorPayouts) || 0,
        totalPlatformRevenue: Number(totals?.totalPlatformRevenue) || 0,
        totalTransactions: Number(totals?.totalTransactions) || 0,
        cancelledAmount: Number(cancelled?.cancelledAmount) || 0,
      });
    } catch (err) {
      logger.error({ err }, "GET /revenue/admin/summary failed");
      res.status(500).json({ error: "Failed to fetch admin revenue summary" });
    }
  },
);

/**
 * GET /revenue/admin/creators?page=1&limit=50
 * Per-creator earnings breakdown with role, share rate, totals.
 */
router.get(
  "/revenue/admin/creators",
  authenticate,
  requireRole("admin", "owner"),
  async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
    const offset = (page - 1) * limit;

    try {
      // Count distinct creators with shares
      const [{ total }] = await db
        .select({ total: count(sql`DISTINCT ${revenueSharesTable.creatorId}`) })
        .from(revenueSharesTable)
        .where(isNotNull(revenueSharesTable.creatorId));

      const rows = await db
        .select({
          creatorId: revenueSharesTable.creatorId,
          username: usersTable.username,
          avatar: usersTable.avatar,
          role: usersTable.role,
          creatorRole: revenueSharesTable.creatorRole,
          totalSales: count(),
          totalEarned: sum(revenueSharesTable.creatorShare),
          totalPlatformShare: sum(revenueSharesTable.platformShare),
          totalRevenue: sum(revenueSharesTable.videoPrice),
          paidOut: sql<number>`SUM(CASE WHEN ${revenueSharesTable.payoutStatus} = 'paid' THEN ${revenueSharesTable.creatorShare} ELSE 0 END)`,
          cancelledAmount: sql<number>`SUM(CASE WHEN ${revenueSharesTable.payoutStatus} = 'cancelled' THEN ${revenueSharesTable.creatorShare} ELSE 0 END)`,
        })
        .from(revenueSharesTable)
        .innerJoin(usersTable, eq(revenueSharesTable.creatorId, usersTable.id))
        .where(isNotNull(revenueSharesTable.creatorId))
        .groupBy(
          revenueSharesTable.creatorId,
          revenueSharesTable.creatorRole,
          usersTable.username,
          usersTable.avatar,
          usersTable.role,
        )
        .orderBy(desc(sum(revenueSharesTable.creatorShare)))
        .limit(limit)
        .offset(offset);

      res.json({
        data: rows.map((r: any) => ({
          creatorId: r.creatorId,
          username: r.username,
          avatar: r.avatar,
          role: r.role,
          creatorRole: r.creatorRole,
          totalSales: Number(r.totalSales) || 0,
          totalEarned: Number(r.totalEarned) || 0,
          totalPlatformShare: Number(r.totalPlatformShare) || 0,
          totalRevenue: Number(r.totalRevenue) || 0,
          paidOut: Number(r.paidOut) || 0,
          cancelledAmount: Number(r.cancelledAmount) || 0,
        })),
        pagination: {
          page,
          limit,
          total: Number(total) || 0,
          totalPages: Math.ceil((Number(total) || 0) / limit),
        },
      });
    } catch (err) {
      logger.error({ err }, "GET /revenue/admin/creators failed");
      res.status(500).json({ error: "Failed to fetch creator revenue report" });
    }
  },
);

/**
 * GET /revenue/admin/top-premium-earners?search=&page=1&limit=50
 * Top earners from PREMIUM videos uploaded by base roles (user/meril),
 * with optional username search. Excludes cancelled shares & bundle sales.
 */
router.get(
  "/revenue/admin/top-premium-earners",
  authenticate,
  requireRole("admin", "owner"),
  async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
    const offset = (page - 1) * limit;
    const search = ((req.query.search as string) || "").trim();

    try {
      // Only individual premium-video purchases where the uploader is a base
      // role (user/meril). Bundle sales (videoId NULL) are excluded by the
      // inner join on videos.
      const where = and(
        isNotNull(revenueSharesTable.creatorId),
        eq(videosTable.visibility, "premium"),
        ne(revenueSharesTable.payoutStatus, "cancelled"),
        or(eq(usersTable.role, "user"), eq(usersTable.role, "meril")),
        search ? ilike(usersTable.username, `%${search}%`) : undefined,
      );

      const [{ total }] = await db
        .select({ total: count(sql`DISTINCT ${revenueSharesTable.creatorId}`) })
        .from(revenueSharesTable)
        .innerJoin(videosTable, eq(revenueSharesTable.videoId, videosTable.id))
        .innerJoin(usersTable, eq(revenueSharesTable.creatorId, usersTable.id))
        .where(where);

      const rows = await db
        .select({
          creatorId: revenueSharesTable.creatorId,
          username: usersTable.username,
          avatar: usersTable.avatar,
          role: usersTable.role,
          totalSales: count(),
          totalEarned: sum(revenueSharesTable.creatorShare),
          totalPlatformShare: sum(revenueSharesTable.platformShare),
          totalRevenue: sum(revenueSharesTable.videoPrice),
          avgShareRate: sql<number>`AVG(${revenueSharesTable.shareRate})`,
        })
        .from(revenueSharesTable)
        .innerJoin(videosTable, eq(revenueSharesTable.videoId, videosTable.id))
        .innerJoin(usersTable, eq(revenueSharesTable.creatorId, usersTable.id))
        .where(where)
        .groupBy(
          revenueSharesTable.creatorId,
          usersTable.username,
          usersTable.avatar,
          usersTable.role,
        )
        .orderBy(desc(sum(revenueSharesTable.creatorShare)))
        .limit(limit)
        .offset(offset);

      res.json({
        data: rows.map((r: any) => ({
          creatorId: r.creatorId,
          username: r.username,
          avatar: r.avatar,
          role: r.role,
          totalSales: Number(r.totalSales) || 0,
          totalEarned: Number(r.totalEarned) || 0,
          totalPlatformShare: Number(r.totalPlatformShare) || 0,
          totalRevenue: Number(r.totalRevenue) || 0,
          avgShareRate: Number(r.avgShareRate) || 0,
        })),
        pagination: {
          page,
          limit,
          total: Number(total) || 0,
          totalPages: Math.ceil((Number(total) || 0) / limit),
        },
      });
    } catch (err) {
      logger.error({ err }, "GET /revenue/admin/top-premium-earners failed");
      res.status(500).json({ error: "Failed to fetch top premium earners" });
    }
  },
);

/**
 * GET /revenue/admin/transactions?page=1&limit=20&creatorId=<uuid>&payoutStatus=pending
 * All revenue share transactions across all creators.
 */
router.get(
  "/revenue/admin/transactions",
  authenticate,
  requireRole("admin", "owner"),
  async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;
    const filterCreatorId = req.query.creatorId as string | undefined;
    const filterStatus = req.query.payoutStatus as "pending" | "paid" | "cancelled" | undefined;

    try {
      const conditions: any[] = [];
      if (filterCreatorId) conditions.push(eq(revenueSharesTable.creatorId, filterCreatorId));
      if (filterStatus) conditions.push(eq(revenueSharesTable.payoutStatus, filterStatus));

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const [{ total }] = await db
        .select({ total: count() })
        .from(revenueSharesTable)
        .where(whereClause);

      const rows = await db
        .select({
          id: revenueSharesTable.id,
          source: sql<string>`CASE WHEN ${revenueSharesTable.purchaseId} IS NOT NULL THEN 'video' ELSE 'bundle' END`,
          purchaseId: revenueSharesTable.purchaseId,
          bundlePurchaseId: revenueSharesTable.bundlePurchaseId,
          videoId: revenueSharesTable.videoId,
          videoTitle: videosTable.title,
          videoPrice: revenueSharesTable.videoPrice,
          creatorShare: revenueSharesTable.creatorShare,
          platformShare: revenueSharesTable.platformShare,
          shareRate: revenueSharesTable.shareRate,
          creatorRole: revenueSharesTable.creatorRole,
          payoutStatus: revenueSharesTable.payoutStatus,
          payoutDate: revenueSharesTable.payoutDate,
          purchasedAt: revenueSharesTable.createdAt,
          creator: {
            id: usersTable.id,
            username: usersTable.username,
            avatar: usersTable.avatar,
          },
        })
        .from(revenueSharesTable)
        .leftJoin(videosTable, eq(revenueSharesTable.videoId, videosTable.id))
        .leftJoin(usersTable, eq(revenueSharesTable.creatorId, usersTable.id))
        .where(whereClause)
        .orderBy(desc(revenueSharesTable.createdAt))
        .limit(limit)
        .offset(offset);

      res.json({
        data: rows.map((r: any) => ({
          ...r,
          sharePercent: Math.round((Number(r.shareRate) || 0) * 100),
        })),
        pagination: {
          page,
          limit,
          total: Number(total) || 0,
          totalPages: Math.ceil((Number(total) || 0) / limit),
        },
      });
    } catch (err) {
      logger.error({ err }, "GET /revenue/admin/transactions failed");
      res.status(500).json({ error: "Failed to fetch revenue transactions" });
    }
  },
);

/**
 * PATCH /revenue/admin/payouts/:id
 * Cancel a revenue_share row with atomic financial reversal.
 *
 * Revenue share rows are marked `paid` automatically at purchase time because
 * the creator wallet credit happens in the same DB transaction as the purchase.
 * This endpoint marks a row `cancelled` (e.g. for refunds/disputes) and
 * atomically reverses the creator wallet credit so the ledger stays consistent.
 *
 * Body: { status: "cancelled" }
 */
router.patch(
  "/revenue/admin/payouts/:id",
  authenticate,
  requireRole("admin", "owner"),
  async (req, res) => {
    const id = req.params["id"] as string;
    const { status } = req.body as { status?: string };

    if (status !== "cancelled") {
      res.status(400).json({
        error: "Only status 'cancelled' is accepted. Revenue shares are settled automatically at purchase time.",
      });
      return;
    }

    try {
      const [existing] = await db
        .select({
          id: revenueSharesTable.id,
          payoutStatus: revenueSharesTable.payoutStatus,
          creatorId: revenueSharesTable.creatorId,
          creatorShare: revenueSharesTable.creatorShare,
          videoId: revenueSharesTable.videoId,
          purchaseId: revenueSharesTable.purchaseId,
          bundlePurchaseId: revenueSharesTable.bundlePurchaseId,
        })
        .from(revenueSharesTable)
        .where(eq(revenueSharesTable.id, id))
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Revenue share record not found" });
        return;
      }
      if (existing.payoutStatus === "cancelled") {
        res.status(400).json({ error: "Record is already cancelled" });
        return;
      }

      // Atomically reverse the creator wallet credit and mark the row cancelled.
      const updated = await db.transaction(async (tx: any) => {
        const [row] = await tx
          .update(revenueSharesTable)
          .set({ payoutStatus: "cancelled", payoutDate: null })
          .where(eq(revenueSharesTable.id, id))
          .returning();

        // Only reverse wallet credit if a creator was paid
        if (existing.creatorId && existing.creatorShare > 0) {
          const refId = existing.purchaseId ?? existing.bundlePurchaseId ?? id;
          const description = `Pembatalan revenue share (refund/dispute): ${refId}`;

          // Debit creator balance
          await tx
            .update(usersTable)
            .set({
              walletBalance: sql`${usersTable.walletBalance} - ${existing.creatorShare}`,
              updatedAt: new Date(),
            })
            .where(eq(usersTable.id, existing.creatorId));

          await tx
            .update(walletsTable)
            .set({
              balance: sql`${walletsTable.balance} - ${existing.creatorShare}`,
              totalEarned: sql`GREATEST(${walletsTable.totalEarned} - ${existing.creatorShare}, 0)`,
              updatedAt: new Date(),
              lastTransactionAt: new Date(),
            })
            .where(eq(walletsTable.userId, existing.creatorId));

          // Compensating ledger entries
          await tx.insert(walletTransactionsTable).values({
            userId: existing.creatorId,
            type: "adjustment",
            amount: -existing.creatorShare,
            balanceAfter: sql`(SELECT wallet_balance FROM users WHERE id = ${existing.creatorId})` as any,
            description,
            referenceType: "revenue_share",
            referenceId: id,
          });

          await tx.insert(transactionsTable).values({
            userId: existing.creatorId,
            type: "adjustment",
            amount: -existing.creatorShare,
            description,
            referenceId: id,
          });
        }

        return row;
      });

      res.json({ revenueShare: updated });
    } catch (err) {
      logger.error({ err }, "PATCH /revenue/admin/payouts/:id failed");
      res.status(500).json({ error: "Failed to cancel revenue share record" });
    }
  },
);

export default router;
