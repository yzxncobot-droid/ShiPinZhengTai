import {
  pgTable, uuid, text, boolean, timestamp, integer, pgEnum, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const chatMessageTypeEnum = pgEnum("chat_message_type", [
  "text", "image", "video", "file", "voice", "gif", "sticker",
]);

export const chatRoomMemberRoleEnum = pgEnum("chat_room_member_role", [
  "member", "moderator", "admin",
]);

// ─── Announcements ────────────────────────────────────────────────────────────

export const announcementsTable = pgTable(
  "announcements",
  {
    id:          uuid("id").defaultRandom().primaryKey(),
    title:       text("title").notNull(),
    content:     text("content").notNull(),
    imageUrl:    text("image_url"),
    videoUrl:    text("video_url"),
    linkUrl:     text("link_url"),
    linkLabel:   text("link_label"),
    createdBy:   uuid("created_by").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    isPinned:    boolean("is_pinned").notNull().default(false),
    visibility:  text("visibility").notNull().default("all"), // all | premium | admin
    createdAt:   timestamp("created_at").notNull().defaultNow(),
    updatedAt:   timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    createdByIdx: index("announcements_created_by_idx").on(t.createdBy),
    createdAtIdx: index("announcements_created_at_idx").on(t.createdAt),
    isPinnedIdx:  index("announcements_is_pinned_idx").on(t.isPinned),
  }),
);

export const announcementReactionsTable = pgTable(
  "announcement_reactions",
  {
    id:             uuid("id").defaultRandom().primaryKey(),
    announcementId: uuid("announcement_id").notNull().references(() => announcementsTable.id, { onDelete: "cascade" }),
    userId:         uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    emoji:          text("emoji").notNull(),
    createdAt:      timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqueReaction: uniqueIndex("announcement_reactions_unique_idx").on(t.announcementId, t.userId, t.emoji),
    annIdIdx:       index("announcement_reactions_ann_idx").on(t.announcementId),
    userIdIdx:      index("announcement_reactions_user_idx").on(t.userId),
  }),
);

export const announcementCommentsTable = pgTable(
  "announcement_comments",
  {
    id:             uuid("id").defaultRandom().primaryKey(),
    announcementId: uuid("announcement_id").notNull().references(() => announcementsTable.id, { onDelete: "cascade" }),
    userId:         uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    content:        text("content").notNull(),
    createdAt:      timestamp("created_at").notNull().defaultNow(),
    updatedAt:      timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    annIdIdx:  index("announcement_comments_ann_idx").on(t.announcementId),
    userIdIdx: index("announcement_comments_user_idx").on(t.userId),
    createdIdx: index("announcement_comments_created_idx").on(t.createdAt),
  }),
);

export const announcementReadsTable = pgTable(
  "announcement_reads",
  {
    id:             uuid("id").defaultRandom().primaryKey(),
    announcementId: uuid("announcement_id").notNull().references(() => announcementsTable.id, { onDelete: "cascade" }),
    userId:         uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    readAt:         timestamp("read_at").notNull().defaultNow(),
  },
  (t) => ({
    unique:    uniqueIndex("announcement_reads_unique_idx").on(t.announcementId, t.userId),
    annIdIdx:  index("announcement_reads_ann_idx").on(t.announcementId),
    userIdx:   index("announcement_reads_user_idx").on(t.userId),
  }),
);

// ─── Public Chat Rooms ────────────────────────────────────────────────────────

export const chatRoomsTable = pgTable(
  "chat_rooms",
  {
    id:               uuid("id").defaultRandom().primaryKey(),
    name:             text("name").notNull(),
    slug:             text("slug").notNull().unique(),
    description:      text("description"),
    imageUrl:         text("image_url"),
    rules:            text("rules"),
    category:         text("category"),                                            // "General" | "Gaming" | "Anime" | etc.
    isPinnedGroup:    boolean("is_pinned_group").notNull().default(false),         // pinned at top of groups list
    isPublic:         boolean("is_public").notNull().default(true),                // public vs private
    sortOrder:        integer("sort_order").notNull().default(0),                  // manual sort order
    memberLimit:      integer("member_limit"),                                     // optional max members
    isLocked:         boolean("is_locked").notNull().default(false),
    slowModeSeconds:  integer("slow_mode_seconds").notNull().default(0),
    createdBy:        uuid("created_by").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt:        timestamp("created_at").notNull().defaultNow(),
    updatedAt:        timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    slugIdx:      uniqueIndex("chat_rooms_slug_idx").on(t.slug),
    createdByIdx: index("chat_rooms_created_by_idx").on(t.createdBy),
    createdAtIdx: index("chat_rooms_created_at_idx").on(t.createdAt),
    categoryIdx:  index("chat_rooms_category_idx").on(t.category),
    pinnedIdx:    index("chat_rooms_pinned_idx").on(t.isPinnedGroup),
  }),
);

export const chatRoomMembersTable = pgTable(
  "chat_room_members",
  {
    id:        uuid("id").defaultRandom().primaryKey(),
    roomId:    uuid("room_id").notNull().references(() => chatRoomsTable.id, { onDelete: "cascade" }),
    userId:    uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    role:      chatRoomMemberRoleEnum("role").notNull().default("member"),
    isBanned:  boolean("is_banned").notNull().default(false),
    isMuted:   boolean("is_muted").notNull().default(false),
    mutedUntil: timestamp("muted_until"),
    joinedAt:  timestamp("joined_at").notNull().defaultNow(),
  },
  (t) => ({
    unique:    uniqueIndex("chat_room_members_unique_idx").on(t.roomId, t.userId),
    roomIdx:   index("chat_room_members_room_idx").on(t.roomId),
    userIdx:   index("chat_room_members_user_idx").on(t.userId),
  }),
);

export const chatMessagesTable = pgTable(
  "chat_messages",
  {
    id:          uuid("id").defaultRandom().primaryKey(),
    roomId:      uuid("room_id").notNull().references(() => chatRoomsTable.id, { onDelete: "cascade" }),
    userId:      uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    content:     text("content").notNull().default(""),
    messageType: chatMessageTypeEnum("message_type").notNull().default("text"),
    fileUrl:     text("file_url"),
    fileName:    text("file_name"),
    replyToId:   uuid("reply_to_id"),
    isPinned:    boolean("is_pinned").notNull().default(false),
    pinnedBy:    uuid("pinned_by").references(() => usersTable.id, { onDelete: "set null" }),
    pinnedAt:    timestamp("pinned_at"),
    isDeleted:   boolean("is_deleted").notNull().default(false),
    editedAt:    timestamp("edited_at"),
    createdAt:   timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    roomIdx:    index("chat_messages_room_idx").on(t.roomId),
    userIdx:    index("chat_messages_user_idx").on(t.userId),
    createdIdx: index("chat_messages_created_idx").on(t.createdAt),
    roomCreatedIdx: index("chat_messages_room_created_idx").on(t.roomId, t.createdAt),
  }),
);

export const chatReactionsTable = pgTable(
  "chat_reactions",
  {
    id:        uuid("id").defaultRandom().primaryKey(),
    messageId: uuid("message_id").notNull().references(() => chatMessagesTable.id, { onDelete: "cascade" }),
    userId:    uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    emoji:     text("emoji").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    unique:    uniqueIndex("chat_reactions_unique_idx").on(t.messageId, t.userId, t.emoji),
    msgIdx:    index("chat_reactions_msg_idx").on(t.messageId),
    userIdx:   index("chat_reactions_user_idx").on(t.userId),
  }),
);

export const chatReadsTable = pgTable(
  "chat_reads",
  {
    id:         uuid("id").defaultRandom().primaryKey(),
    roomId:     uuid("room_id").notNull().references(() => chatRoomsTable.id, { onDelete: "cascade" }),
    userId:     uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    lastReadAt: timestamp("last_read_at").notNull().defaultNow(),
  },
  (t) => ({
    unique:   uniqueIndex("chat_reads_unique_idx").on(t.roomId, t.userId),
    roomIdx:  index("chat_reads_room_idx").on(t.roomId),
    userIdx:  index("chat_reads_user_idx").on(t.userId),
  }),
);

// ─── Types ────────────────────────────────────────────────────────────────────
export type Announcement         = typeof announcementsTable.$inferSelect;
export type AnnouncementReaction = typeof announcementReactionsTable.$inferSelect;
export type AnnouncementComment  = typeof announcementCommentsTable.$inferSelect;
export type ChatRoom             = typeof chatRoomsTable.$inferSelect;
export type ChatRoomMember       = typeof chatRoomMembersTable.$inferSelect;
export type ChatMessage          = typeof chatMessagesTable.$inferSelect;
export type ChatReaction         = typeof chatReactionsTable.$inferSelect;
