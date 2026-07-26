import {
  pgTable, uuid, text, timestamp, boolean, index,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * user_bans
 * Tracks full ban history. `users.is_banned` is kept in sync as a fast-read
 * cache for the auth middleware. When a ban expires (temp ban), a scheduled
 * check or next-login will clear `users.is_banned`.
 */
export const userBansTable = pgTable(
  "user_bans",
  {
    id:          uuid("id").defaultRandom().primaryKey(),
    userId:      uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    /** "permanent" | "temporary" */
    banType:     text("ban_type").notNull().default("permanent"),
    reason:      text("reason"),
    /** For temporary bans – when the ban automatically lifts. */
    expiresAt:   timestamp("expires_at"),
    bannedBy:    uuid("banned_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt:   timestamp("created_at").notNull().defaultNow(),
    /** Whether this ban is still active (false = unbanned / superseded) */
    isActive:    boolean("is_active").notNull().default(true),
    revokedAt:   timestamp("revoked_at"),
    revokedBy:   uuid("revoked_by").references(() => usersTable.id, { onDelete: "set null" }),
    revokedNote: text("revoked_note"),
  },
  (t) => ({
    userIdx:      index("user_bans_user_idx").on(t.userId),
    isActiveIdx:  index("user_bans_is_active_idx").on(t.isActive),
    bannedByIdx:  index("user_bans_banned_by_idx").on(t.bannedBy),
  }),
);

/**
 * user_mutes
 * Global (platform-wide) mutes — prevents a user from sending chat messages
 * in any room. Separate from per-room mutes in chat_room_members.
 */
export const userMutesTable = pgTable(
  "user_mutes",
  {
    id:        uuid("id").defaultRandom().primaryKey(),
    userId:    uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    reason:    text("reason"),
    expiresAt: timestamp("expires_at"),   // null = permanent mute
    mutedBy:   uuid("muted_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    isActive:  boolean("is_active").notNull().default(true),
    revokedAt: timestamp("revoked_at"),
    revokedBy: uuid("revoked_by").references(() => usersTable.id, { onDelete: "set null" }),
  },
  (t) => ({
    userIdx:     index("user_mutes_user_idx").on(t.userId),
    isActiveIdx: index("user_mutes_is_active_idx").on(t.isActive),
  }),
);

export type UserBan  = typeof userBansTable.$inferSelect;
export type UserMute = typeof userMutesTable.$inferSelect;
