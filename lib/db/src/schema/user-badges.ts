import {
  pgTable, uuid, text, timestamp, index,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * user_badges
 * Stores cosmetic/authority badges assigned to users by staff.
 * Multiple badges per user are allowed.
 */
export const userBadgesTable = pgTable(
  "user_badges",
  {
    id:         uuid("id").defaultRandom().primaryKey(),
    userId:     uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    /** Predefined badge slug: "verified"|"developer"|"staff"|"owner"|"admin"|"moderator"|
     *  "creator"|"vip"|"premium"|"official"|"early_supporter"|"beta_tester"|"custom" */
    badge:      text("badge").notNull(),
    /** Optional override label (used for "custom" badge type) */
    label:      text("label"),
    /** Optional hex color override */
    color:      text("color"),
    /** Optional icon name override */
    icon:       text("icon"),
    assignedBy: uuid("assigned_by").references(() => usersTable.id, { onDelete: "set null" }),
    assignedAt: timestamp("assigned_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdx:      index("user_badges_user_idx").on(t.userId),
    assignedByIdx: index("user_badges_assigned_by_idx").on(t.assignedBy),
  }),
);

export type UserBadge = typeof userBadgesTable.$inferSelect;
