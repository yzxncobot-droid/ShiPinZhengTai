import {
  pgTable, uuid, text, integer, timestamp, index, pgEnum,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const pointActivityEnum = pgEnum("point_activity", [
  "watch_video",
  "like_video",
  "comment",
  "share_video",
  "upload_video",
  "video_liked",
  "video_viewed",
  "daily_login",
  "daily_streak",
  "redeem_event",
  "badge_earned",
]);

export const leaderboardCategoryEnum = pgEnum("leaderboard_category", [
  "all",
  "viewer",
  "uploader",
  "activity",
  "badge",
]);

export const leaderboardPeriodEnum = pgEnum("leaderboard_period", [
  "weekly",
  "monthly",
  "alltime",
]);

/**
 * point_logs
 * Tracks individual point-earning events per user.
 * Used to power category-specific leaderboards.
 */
export const pointLogsTable = pgTable(
  "point_logs",
  {
    id:          uuid("id").defaultRandom().primaryKey(),
    userId:      uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    activity:    pointActivityEnum("activity").notNull(),
    points:      integer("points").notNull(),
    referenceId: uuid("reference_id"),  // optional: videoId, commentId, etc.
    createdAt:   timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdx:      index("point_logs_user_idx").on(t.userId),
    createdAtIdx: index("point_logs_created_at_idx").on(t.createdAt),
    activityIdx:  index("point_logs_activity_idx").on(t.activity),
  }),
);

/**
 * leaderboard_history
 * Snapshot of rankings at a point in time.
 * Written by the recalculate endpoint; used for history view.
 */
export const leaderboardHistoryTable = pgTable(
  "leaderboard_history",
  {
    id:        uuid("id").defaultRandom().primaryKey(),
    userId:    uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    rank:      integer("rank").notNull(),
    category:  leaderboardCategoryEnum("category").notNull(),
    period:    leaderboardPeriodEnum("period").notNull(),
    points:    integer("points").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdx:           index("leaderboard_history_user_idx").on(t.userId),
    categoryPeriodIdx: index("leaderboard_history_cat_period_idx").on(t.category, t.period),
    createdAtIdx:      index("leaderboard_history_created_at_idx").on(t.createdAt),
  }),
);

export type PointLog = typeof pointLogsTable.$inferSelect;
export type LeaderboardHistory = typeof leaderboardHistoryTable.$inferSelect;
