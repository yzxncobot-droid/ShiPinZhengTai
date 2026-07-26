import {
  pgTable, uuid, text, integer, boolean, timestamp, doublePrecision,
  pgEnum, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { chatRoomsTable } from "./chat";

export const dropStatusEnum = pgEnum("drop_status", [
  "scheduled", "active", "completed", "cancelled",
]);

/**
 * drops
 * One row per drop event created by the owner.
 */
export const dropsTable = pgTable(
  "drops",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    description: text("description"),
    /** "wallet_balance"|"premium_subscription"|"premium_video"|"bundle"|
     *  "coupon"|"redeem_code"|"xp"|"coins"|"badge"|"custom" */
    rewardType: text("reward_type").notNull(),
    /** Human-readable reward description, e.g. "50000" for coins or a plan ID. */
    rewardValue: text("reward_value").notNull(),
    /** Numeric quantity (for wallet_balance / coins / xp). */
    rewardAmount: doublePrecision("reward_amount"),
    maxWinners: integer("max_winners").notNull().default(100),
    currentClaims: integer("current_claims").notNull().default(0),
    /** Max claims per user (default 1). */
    maxClaimPerUser: integer("max_claim_per_user").notNull().default(1),
    startTime: timestamp("start_time").notNull(),
    endTime: timestamp("end_time").notNull(),
    status: dropStatusEnum("status").notNull().default("scheduled"),
    buttonColor: text("button_color").default("#8b5cf6"),
    /** Optional: pin the drop to a specific chat room. */
    roomId: uuid("room_id").references(() => chatRoomsTable.id),
    createdBy: uuid("created_by").notNull().references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    statusIdx:    index("drops_status_idx").on(t.status),
    startTimeIdx: index("drops_start_time_idx").on(t.startTime),
    createdByIdx: index("drops_created_by_idx").on(t.createdBy),
  }),
);

/**
 * drop_claims
 * One row per user per drop. The unique index prevents duplicate claims at the DB level.
 */
export const dropClaimsTable = pgTable(
  "drop_claims",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    dropId: uuid("drop_id").notNull().references(() => dropsTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => usersTable.id),
    claimedAt: timestamp("claimed_at").notNull().defaultNow(),
    rewardGranted: boolean("reward_granted").notNull().default(false),
    /** JSON blob storing what was actually awarded. */
    rewardDetails: text("reward_details"),
  },
  (t) => ({
    uniqueUserDrop: uniqueIndex("drop_claims_unique_user_drop").on(t.dropId, t.userId),
    dropIdx:        index("drop_claims_drop_idx").on(t.dropId),
    userIdx:        index("drop_claims_user_idx").on(t.userId),
  }),
);

/**
 * drop_logs
 * Immutable audit trail for every drop event.
 */
export const dropLogsTable = pgTable(
  "drop_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    dropId: uuid("drop_id").references(() => dropsTable.id),
    userId: uuid("user_id").references(() => usersTable.id),
    /** "created"|"activated"|"claimed"|"cancelled"|"completed"|"reward_granted"|"reward_failed" */
    action: text("action").notNull(),
    details: text("details"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    dropIdx: index("drop_logs_drop_idx").on(t.dropId),
  }),
);

export type Drop      = typeof dropsTable.$inferSelect;
export type DropClaim = typeof dropClaimsTable.$inferSelect;
export type DropLog   = typeof dropLogsTable.$inferSelect;
