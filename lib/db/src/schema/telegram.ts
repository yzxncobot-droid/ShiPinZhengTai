import {
  pgTable, uuid, text, integer, boolean, timestamp,
  bigint, doublePrecision, pgEnum, uniqueIndex, index,
} from "drizzle-orm/pg-core";

// ── Enums ────────────────────────────────────────────────────────────────────

export const telegramSourceTypeEnum = pgEnum("telegram_source_type", ["GROUP", "CHANNEL"]);

export const telegramSourceStatusEnum = pgEnum("telegram_source_status", [
  "CONNECTED", "DISCONNECTED", "ERROR", "SYNCING", "UNKNOWN",
]);

export const telegramSyncTypeEnum = pgEnum("telegram_sync_type", [
  "initial", "incremental", "manual",
]);

export const telegramSyncStatusEnum = pgEnum("telegram_sync_status", [
  "success", "error", "in_progress",
]);

// ── telegram_sources ─────────────────────────────────────────────────────────
// Admin-registered Telegram channels/groups. Relational — no limit on count.

export const telegramSourcesTable = pgTable(
  "telegram_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    /** Telegram chat ID (e.g. -100123456789). Never hardcoded — admin-supplied. */
    chatId: text("chat_id").notNull(),
    type: telegramSourceTypeEnum("type").notNull().default("CHANNEL"),
    description: text("description"),
    enabled: boolean("enabled").notNull().default(true),
    status: telegramSourceStatusEnum("status").notNull().default("UNKNOWN"),
    lastConnectionCheck: timestamp("last_connection_check"),
    lastSyncAt: timestamp("last_sync_at"),
    videoCount: integer("video_count").notNull().default(0),
    errorMessage: text("error_message"),
    /** Highest Telegram message ID processed — used for incremental sync. */
    lastSyncedMessageId: text("last_synced_message_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    chatIdIdx: index("telegram_sources_chat_id_idx").on(t.chatId),
  }),
);

// ── telegram_videos ──────────────────────────────────────────────────────────
// Metadata-only records for videos found in Telegram sources.
// Video binary stays in Telegram — the website is a streaming proxy + player.

export const telegramVideosTable = pgTable(
  "telegram_videos",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    telegramSourceId: uuid("telegram_source_id").notNull().references(
      () => telegramSourcesTable.id, { onDelete: "cascade" },
    ),
    telegramChatId: text("telegram_chat_id").notNull(),
    telegramMessageId: text("telegram_message_id").notNull(),
    /** Telegram document ID — reference only; the message is re-fetched for streaming. */
    telegramFileId: text("telegram_file_id"),
    fileName: text("file_name"),
    title: text("title"),
    mimeType: text("mime_type"),
    fileSize: bigint("file_size", { mode: "number" }),
    duration: integer("duration"), // seconds
    width: integer("width"),
    height: integer("height"),
    thumbnailFileId: text("thumbnail_file_id"),
    caption: text("caption"),
    telegramDate: timestamp("telegram_date"),
    isPremium: boolean("is_premium").notNull().default(false),
    price: doublePrecision("price"),
    indexedAt: timestamp("indexed_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    sourceMsgUniq: uniqueIndex("telegram_videos_source_msg_uniq").on(
      t.telegramSourceId, t.telegramMessageId,
    ),
    sourceIdx: index("telegram_videos_source_idx").on(t.telegramSourceId),
    chatIdx: index("telegram_videos_chat_idx").on(t.telegramChatId),
  }),
);

// ── telegram_sync_logs ────────────────────────────────────────────────────────
// Audit trail for every sync operation (initial / incremental / manual).

export const telegramSyncLogsTable = pgTable(
  "telegram_sync_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    telegramSourceId: uuid("telegram_source_id").notNull().references(
      () => telegramSourcesTable.id, { onDelete: "cascade" },
    ),
    syncType: telegramSyncTypeEnum("sync_type").notNull(),
    status: telegramSyncStatusEnum("status").notNull().default("in_progress"),
    newVideos: integer("new_videos").notNull().default(0),
    updatedVideos: integer("updated_videos").notNull().default(0),
    skippedVideos: integer("skipped_videos").notNull().default(0),
    errorsCount: integer("errors_count").notNull().default(0),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (t) => ({
    sourceIdx: index("telegram_sync_logs_source_idx").on(t.telegramSourceId),
  }),
);

export type TelegramSource = typeof telegramSourcesTable.$inferSelect;
export type TelegramVideo = typeof telegramVideosTable.$inferSelect;
export type TelegramSyncLog = typeof telegramSyncLogsTable.$inferSelect;
