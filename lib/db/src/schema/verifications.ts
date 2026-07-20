import {
  pgTable, uuid, text, timestamp, pgEnum, index,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const verificationStatusEnum = pgEnum("verification_status", [
  "active", "revoked",
]);

/**
 * creator_verifications
 * One active row per user per badge type.
 * badge_type is stored as plain text to avoid enum migration pain.
 * Valid values: "blue" | "gold" | "sulthan"
 */
export const creatorVerificationsTable = pgTable(
  "creator_verifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    /** "blue" | "gold" | "sulthan" */
    badgeType: text("badge_type").notNull(),
    status: verificationStatusEnum("status").notNull().default("active"),
    verifiedAt: timestamp("verified_at").notNull().defaultNow(),
    verifiedBy: uuid("verified_by").references(() => usersTable.id),
    revokedAt: timestamp("revoked_at"),
    revokedBy: uuid("revoked_by").references(() => usersTable.id),
    reason: text("reason"),
  },
  (t) => ({
    userIdx:   index("cv_user_idx").on(t.userId),
    statusIdx: index("cv_status_idx").on(t.status),
  }),
);

/**
 * verification_history
 * Immutable audit log of every verification action.
 */
export const verificationHistoryTable = pgTable(
  "verification_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    verificationId: uuid("verification_id").references(() => creatorVerificationsTable.id),
    userId: uuid("user_id").notNull().references(() => usersTable.id),
    /** "granted" | "revoked" | "sulthan_granted" | "sulthan_removed" */
    action: text("action").notNull(),
    performedBy: uuid("performed_by").references(() => usersTable.id),
    badgeType: text("badge_type"),
    note: text("note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdx:      index("vh_user_idx").on(t.userId),
    createdAtIdx: index("vh_created_at_idx").on(t.createdAt),
  }),
);

export type CreatorVerification = typeof creatorVerificationsTable.$inferSelect;
export type VerificationHistory  = typeof verificationHistoryTable.$inferSelect;
