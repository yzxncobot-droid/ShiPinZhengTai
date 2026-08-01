import {
  pgTable, uuid, text, boolean, timestamp, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// ─── Conversations ─────────────────────────────────────────────────────────────

export const conversationsTable = pgTable(
  "conversations",
  {
    id:        uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
);

// ─── Conversation Members ─────────────────────────────────────────────────────

export const conversationMembersTable = pgTable(
  "conversation_members",
  {
    id:             uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id").notNull().references(() => conversationsTable.id, { onDelete: "cascade" }),
    userId:         uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    isPinned:       boolean("is_pinned").notNull().default(false),
    isArchived:     boolean("is_archived").notNull().default(false),
    isFavorite:     boolean("is_favorite").notNull().default(false),
    isMuted:        boolean("is_muted").notNull().default(false),
    isBlocked:      boolean("is_blocked").notNull().default(false),
    joinedAt:       timestamp("joined_at").notNull().defaultNow(),
  },
  (t) => ({
    unique:   uniqueIndex("conversation_members_unique_idx").on(t.conversationId, t.userId),
    convIdx:  index("conversation_members_conv_idx").on(t.conversationId),
    userIdx:  index("conversation_members_user_idx").on(t.userId),
  }),
);

// ─── Direct Messages ──────────────────────────────────────────────────────────

export const directMessagesTable = pgTable(
  "direct_messages",
  {
    id:              uuid("id").defaultRandom().primaryKey(),
    conversationId:  uuid("conversation_id").notNull().references(() => conversationsTable.id, { onDelete: "cascade" }),
    senderId:        uuid("sender_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    content:         text("content").notNull().default(""),
    messageType:     text("message_type").notNull().default("text"), // text|image|sticker|gif|voice|file
    fileUrl:         text("file_url"),
    fileName:        text("file_name"),
    replyToId:       uuid("reply_to_id"),
    isDeletedSender: boolean("is_deleted_sender").notNull().default(false),
    isDeletedAll:    boolean("is_deleted_all").notNull().default(false),
    editedAt:        timestamp("edited_at"),
    createdAt:       timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    convIdx:     index("direct_messages_conv_idx").on(t.conversationId),
    senderIdx:   index("direct_messages_sender_idx").on(t.senderId),
    createdIdx:  index("direct_messages_created_idx").on(t.createdAt),
    convCreatedIdx: index("direct_messages_conv_created_idx").on(t.conversationId, t.createdAt),
  }),
);

// ─── DM Reactions ─────────────────────────────────────────────────────────────

export const dmReactionsTable = pgTable(
  "dm_reactions",
  {
    id:        uuid("id").defaultRandom().primaryKey(),
    messageId: uuid("message_id").notNull().references(() => directMessagesTable.id, { onDelete: "cascade" }),
    userId:    uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    emoji:     text("emoji").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    unique:   uniqueIndex("dm_reactions_unique_idx").on(t.messageId, t.userId, t.emoji),
    msgIdx:   index("dm_reactions_msg_idx").on(t.messageId),
    userIdx:  index("dm_reactions_user_idx").on(t.userId),
  }),
);

// ─── DM Reads ─────────────────────────────────────────────────────────────────

export const dmReadsTable = pgTable(
  "dm_reads",
  {
    id:             uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id").notNull().references(() => conversationsTable.id, { onDelete: "cascade" }),
    userId:         uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    lastReadAt:     timestamp("last_read_at").notNull().defaultNow(),
  },
  (t) => ({
    unique:   uniqueIndex("dm_reads_unique_idx").on(t.conversationId, t.userId),
    convIdx:  index("dm_reads_conv_idx").on(t.conversationId),
    userIdx:  index("dm_reads_user_idx").on(t.userId),
  }),
);

// ─── Types ────────────────────────────────────────────────────────────────────
export type Conversation       = typeof conversationsTable.$inferSelect;
export type ConversationMember = typeof conversationMembersTable.$inferSelect;
export type DirectMessage      = typeof directMessagesTable.$inferSelect;
export type DmReaction         = typeof dmReactionsTable.$inferSelect;
export type DmRead             = typeof dmReadsTable.$inferSelect;
