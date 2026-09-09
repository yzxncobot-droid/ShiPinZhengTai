import {
  pgTable, uuid, text, integer, boolean, timestamp,
  doublePrecision, pgEnum, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { telegramSourcesTable } from "./telegram";
import { usersTable } from "./users";

// ── Enums ────────────────────────────────────────────────────────────────────

export const autoupProcessingStatusEnum = pgEnum("autoup_processing_status", [
  "pending", "processing", "completed", "failed", "skipped",
]);

// ── autoup_configs ────────────────────────────────────────────────────────────
// Owner-defined automation configs. Each config watches one Telegram source
// and automatically imports new videos into the website catalog with the
// config's premium/price/description settings.

export const autoupConfigsTable = pgTable(
  "autoup_configs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    telegramSourceId: uuid("telegram_source_id").notNull().references(
      () => telegramSourcesTable.id, { onDelete: "cascade" },
    ),
    isPremium: boolean("is_premium").notNull().default(false),
    price: doublePrecision("price"),
    /** Nullable — when NULL, imported video descriptions are empty/null. */
    description: text("description"),
    enabled: boolean("enabled").notNull().default(true),
    /** User ID of the admin/owner who created this config (used as creatorId). */
    createdBy: uuid("created_by").references(
      () => usersTable.id, { onDelete: "set null" },
    ),
    lastProcessedAt: timestamp("last_processed_at"),
    processedCount: integer("processed_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    /** Highest Telegram message ID scanned — used for incremental polling. */
    lastProcessedMessageId: text("last_processed_message_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    sourceIdx: index("autoup_configs_source_idx").on(t.telegramSourceId),
    enabledIdx: index("autoup_configs_enabled_idx").on(t.enabled),
  }),
);

// ── autoup_processing_logs ───────────────────────────────────────────────────
// One row per video processing attempt. Used for the log viewer + stats.

export const autoupProcessingLogsTable = pgTable(
  "autoup_processing_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    autoupConfigId: uuid("autoup_config_id").notNull().references(
      () => autoupConfigsTable.id, { onDelete: "cascade" },
    ),
    telegramSourceId: uuid("telegram_source_id").notNull(),
    telegramChatId: text("telegram_chat_id"),
    telegramMessageId: text("telegram_message_id").notNull(),
    title: text("title"),
    thumbnail: text("thumbnail"),
    status: autoupProcessingStatusEnum("status").notNull().default("pending"),
    errorMessage: text("error_message"),
    /** Created videos table entry ID (on success). */
    videoId: uuid("video_id"),
    /** Created/linked telegram_videos entry ID. */
    telegramVideoId: uuid("telegram_video_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    processedAt: timestamp("processed_at"),
  },
  (t) => ({
    configIdx: index("autoup_logs_config_idx").on(t.autoupConfigId),
    statusIdx: index("autoup_logs_status_idx").on(t.status),
    // Duplicate protection: one message per config → at most one log row.
    configMsgUniq: uniqueIndex("autoup_logs_config_msg_uniq").on(
      t.autoupConfigId, t.telegramMessageId,
    ),
  }),
);

export type AutoUpConfig = typeof autoupConfigsTable.$inferSelect;
export type AutoUpProcessingLog = typeof autoupProcessingLogsTable.$inferSelect;
