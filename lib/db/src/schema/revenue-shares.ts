import {
  pgTable, uuid, doublePrecision, text, timestamp, pgEnum, index, check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";
import { videosTable } from "./videos";
import { videoPurchasesTable } from "./video-purchases";
import { bundlePurchasesTable } from "./bundles";

export const payoutStatusEnum = pgEnum("payout_status", [
  "pending", "paid", "cancelled",
]);

/**
 * revenue_shares — one row per successful premium video OR bundle purchase.
 * Records the exact split between creator and platform at the moment of sale.
 *
 * Exactly one of purchaseId (video sale) OR bundlePurchaseId (bundle sale) must be set.
 *
 * Share rates (creator earns):
 *   verified_creator → 75%  (platform keeps 25%)
 *   creator          → 50%  (platform keeps 50%)
 *   admin / owner    → 0%   (platform keeps 100%; no individual creator)
 *   platform (bundle)→ 0%   (bundles have no individual creator)
 */
export const revenueSharesTable = pgTable(
  "revenue_shares",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    /**
     * Set for individual video purchases; NULL for bundle purchases.
     * Exactly one of purchaseId / bundlePurchaseId must be non-null
     * (enforced by CHECK constraint revenue_shares_source_check).
     */
    purchaseId: uuid("purchase_id")
      .references(() => videoPurchasesTable.id, { onDelete: "cascade" }),

    /** Set for bundle purchases; NULL for individual video purchases. */
    bundlePurchaseId: uuid("bundle_purchase_id")
      .references(() => bundlePurchasesTable.id, { onDelete: "cascade" }),

    /**
     * The video that was purchased (individual sale).
     * NULL for bundle purchases (a bundle spans multiple videos).
     */
    videoId: uuid("video_id")
      .references(() => videosTable.id, { onDelete: "cascade" }),

    /** Creator who owns the video. NULL for admin/owner/platform uploads. */
    creatorId: uuid("creator_id")
      .references(() => usersTable.id, { onDelete: "set null" }),

    /** Buyer / customer. */
    buyerId: uuid("buyer_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),

    /** Snapshot of the video/bundle price at the time of purchase. */
    videoPrice: doublePrecision("video_price").notNull(),

    /** Amount credited to the creator's wallet (0 for admin/owner/bundle). */
    creatorShare: doublePrecision("creator_share").notNull(),

    /** Amount kept by the platform. */
    platformShare: doublePrecision("platform_share").notNull(),

    /** Creator's share rate at time of purchase (e.g. 0.75 = 75%). */
    shareRate: doublePrecision("share_rate").notNull(),

    /**
     * Role of the uploader at the time of purchase.
     * Stored as plain text so it survives future role enum changes.
     * "platform" is used for bundle purchases and admin/owner uploads.
     */
    creatorRole: text("creator_role").notNull(),

    /**
     * Payout status for the creator share.
     * Default is 'paid' — creator wallet is credited atomically at purchase time.
     * Only 'cancelled' is used after the fact (e.g. refund/dispute reversal).
     */
    payoutStatus: payoutStatusEnum("payout_status").notNull().default("paid"),

    /** When the creator's share was marked as paid. */
    payoutDate: timestamp("payout_date"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ([
    // Exactly one source must be set
    check(
      "revenue_shares_source_check",
      sql`(${t.purchaseId} IS NOT NULL AND ${t.bundlePurchaseId} IS NULL) OR
          (${t.purchaseId} IS NULL AND ${t.bundlePurchaseId} IS NOT NULL)`,
    ),
    index("revenue_shares_purchase_id_idx").on(t.purchaseId),
    index("revenue_shares_bundle_purchase_id_idx").on(t.bundlePurchaseId),
    index("revenue_shares_creator_id_idx").on(t.creatorId),
    index("revenue_shares_buyer_id_idx").on(t.buyerId),
    index("revenue_shares_video_id_idx").on(t.videoId),
    index("revenue_shares_created_at_idx").on(t.createdAt),
    index("revenue_shares_payout_status_idx").on(t.payoutStatus),
  ]),
);

export type RevenueShare = typeof revenueSharesTable.$inferSelect;
export type NewRevenueShare = typeof revenueSharesTable.$inferInsert;
