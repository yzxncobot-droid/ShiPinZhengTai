import {
  pgTable, serial, integer, doublePrecision, boolean, timestamp, text,
  pgEnum, index, unique,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const referralStatusEnum = pgEnum("referral_status", [
  "pending",   // referral registered, reward not yet granted
  "rewarded",  // bonus credited to referrer
  "voided",    // referred user banned / reversed
]);

/**
 * referrals – one row per successful referral link.
 * The referred user's ID is stored in `usersTable.referredBy`.
 */
export const referralsTable = pgTable(
  "referrals",
  {
    id: serial("id").primaryKey(),
    referrerId: integer("referrer_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    referredId: integer("referred_id").notNull().unique().references(() => usersTable.id, { onDelete: "cascade" }),
    status: referralStatusEnum("status").notNull().default("pending"),
    bonusAmount: doublePrecision("bonus_amount").notNull().default(0),
    bonusCredited: boolean("bonus_credited").notNull().default(false),
    /** The referral code that was used at signup. */
    codeUsed: text("code_used").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    referrerIdx:  index("referrals_referrer_idx").on(t.referrerId),
    referredIdx:  index("referrals_referred_idx").on(t.referredId),
    referredUniq: unique("referrals_referred_unique").on(t.referredId),
  }),
);

export type Referral = typeof referralsTable.$inferSelect;
