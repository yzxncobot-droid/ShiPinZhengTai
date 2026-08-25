import {
  pgTable, uuid, text, integer, boolean, timestamp,
  pgEnum, unique, index,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Home Feed — TikTok-style vertical video feed (separate from Shop products).
 *
 * The Home feed has its own video table so it never mixes with the Shop
 * `videosTable` (products, purchases, wallet, etc.). Video files & thumbnails
 * are stored in the MEDIA Supabase project (Media_Supabase); only metadata
 * lives here.
 *
 * Reward progress is per-VIDEO (never per-user): it is computed from the total
 * number of likes or comments on the video, compared to `rewardTarget`.
 */

export const homeFeedRewardTypeEnum = pgEnum("home_feed_reward_type", [
  "LIKE",
  "COMMENT",
  "NONE",
]);

export const homeFeedVideosTable = pgTable(
  "home_feed_videos",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    description: text("description"),
    /** Public CDN URL of the video file (stored in Media_Supabase). */
    videoUrl: text("video_url").notNull(),
    /** Public CDN URL of the thumbnail image (stored in Media_Supabase). */
    thumbnail: text("thumbnail"),
    /** CMS status: "published" (visible) or "draft" (hidden). */
    status: text("status").notNull().default("published"),
    /** Soft on/off switch independent of draft/published status. */
    isActive: boolean("is_active").notNull().default(true),
    /** Lower numbers appear first in the feed. */
    sortOrder: integer("sort_order").notNull().default(0),
    /** Which metric drives the reward progress. */
    rewardType: homeFeedRewardTypeEnum("reward_type").notNull().default("NONE"),
    /** The total count of likes/comments needed to unlock the reward. */
    rewardTarget: integer("reward_target").notNull().default(0),
    /** Secret code revealed only when the target is reached. */
    rewardCode: text("reward_code"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    sortOrderIdx: index("home_feed_videos_sort_idx").on(t.sortOrder),
    activeIdx: index("home_feed_videos_active_idx").on(t.isActive),
    createdAtIdx: index("home_feed_videos_created_idx").on(t.createdAt),
  }),
);

export const homeFeedLikesTable = pgTable(
  "home_feed_likes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    videoId: uuid("video_id").notNull().references(() => homeFeedVideosTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ([
    unique("home_feed_likes_video_user_uniq").on(t.videoId, t.userId),
    index("home_feed_likes_video_idx").on(t.videoId),
    index("home_feed_likes_user_idx").on(t.userId),
  ]),
);

export const homeFeedCommentsTable = pgTable(
  "home_feed_comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    videoId: uuid("video_id").notNull().references(() => homeFeedVideosTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    videoIdx: index("home_feed_comments_video_idx").on(t.videoId),
    userIdx: index("home_feed_comments_user_idx").on(t.userId),
    createdIdx: index("home_feed_comments_created_idx").on(t.createdAt),
  }),
);

export type HomeFeedVideo = typeof homeFeedVideosTable.$inferSelect;
export type HomeFeedLike = typeof homeFeedLikesTable.$inferSelect;
export type HomeFeedComment = typeof homeFeedCommentsTable.$inferSelect;
export type HomeFeedRewardType = "LIKE" | "COMMENT" | "NONE";
