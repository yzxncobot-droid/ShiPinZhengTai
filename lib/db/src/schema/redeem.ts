import {
  pgTable, uuid, text, integer, boolean, timestamp, doublePrecision,
  pgEnum, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const redeemStatusEnum = pgEnum("redeem_status", [
  "success", "expired", "used", "not_found", "not_active", "limit_reached", "pending",
]);

export const redeemRewardTypeEnum = pgEnum("redeem_reward_type", [
  "coin", "wallet_balance", "bundle", "premium_membership",
  "video_unlock", "badge", "coupon", "discount", "custom",
]);

/**
 * redeem_codes
 * One row per unique code created by admin/owner.
 */
export const redeemCodesTable = pgTable(
  "redeem_codes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Stored in UPPERCASE. */
    code: text("code").notNull().unique(),
    rewardType: redeemRewardTypeEnum("reward_type").notNull(),
    /** Numeric quantity — coins, days, amount, etc. */
    rewardValue: doublePrecision("reward_value").notNull().default(0),
    rewardName: text("reward_name").notNull(),
    description: text("description"),
    /** 0 = unlimited */
    maxUse: integer("max_use").notNull().default(1),
    usedCount: integer("used_count").notNull().default(0),
    expiresAt: timestamp("expires_at"),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: uuid("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    codeIdx: uniqueIndex("redeem_codes_code_idx").on(t.code),
    activeIdx: index("redeem_codes_active_idx").on(t.isActive),
  }),
);

/**
 * redeem_history
 * One row per successful (or attempted) redeem per user per code.
 */
export const redeemHistoryTable = pgTable(
  "redeem_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => usersTable.id),
    redeemCodeId: uuid("redeem_code_id").notNull().references(() => redeemCodesTable.id),
    /** JSON blob of the reward actually granted. */
    claimedReward: text("claimed_reward"),
    status: redeemStatusEnum("status").notNull().default("success"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    /** Prevent the same user from claiming the same code twice at the DB level. */
    uniqueUserCode: uniqueIndex("redeem_history_unique_user_code").on(t.userId, t.redeemCodeId),
    userIdx: index("redeem_history_user_idx").on(t.userId),
    codeIdx: index("redeem_history_code_idx").on(t.redeemCodeId),
  }),
);

export type RedeemCode    = typeof redeemCodesTable.$inferSelect;
export type RedeemHistory = typeof redeemHistoryTable.$inferSelect;
