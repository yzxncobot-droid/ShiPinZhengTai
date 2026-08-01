import {
  pgTable, uuid, text, timestamp, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// ─── Followers ────────────────────────────────────────────────────────────────

export const followersTable = pgTable(
  "followers",
  {
    id:          uuid("id").defaultRandom().primaryKey(),
    followerId:  uuid("follower_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    followingId: uuid("following_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt:   timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    unique:       uniqueIndex("followers_unique_idx").on(t.followerId, t.followingId),
    followerIdx:  index("followers_follower_idx").on(t.followerId),
    followingIdx: index("followers_following_idx").on(t.followingId),
  }),
);

// ─── Blocked Users ────────────────────────────────────────────────────────────

export const blockedUsersTable = pgTable(
  "blocked_users",
  {
    id:        uuid("id").defaultRandom().primaryKey(),
    blockerId: uuid("blocker_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    blockedId: uuid("blocked_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    unique:     uniqueIndex("blocked_users_unique_idx").on(t.blockerId, t.blockedId),
    blockerIdx: index("blocked_users_blocker_idx").on(t.blockerId),
    blockedIdx: index("blocked_users_blocked_idx").on(t.blockedId),
  }),
);

// ─── User Presence ────────────────────────────────────────────────────────────

export const userPresenceTable = pgTable(
  "user_presence",
  {
    userId:    uuid("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
    status:    text("status").notNull().default("offline"), // "online" | "offline" | "away"
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
    updatedAt:  timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    statusIdx:    index("user_presence_status_idx").on(t.status),
    lastSeenIdx:  index("user_presence_last_seen_idx").on(t.lastSeenAt),
  }),
);

// ─── Types ────────────────────────────────────────────────────────────────────
export type Follower    = typeof followersTable.$inferSelect;
export type BlockedUser = typeof blockedUsersTable.$inferSelect;
export type UserPresence = typeof userPresenceTable.$inferSelect;
