import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * app_secrets — persistent key-value store for sensitive application secrets
 * that must survive server restarts but don't belong in the settings table.
 *
 * Currently used for:
 *   - telegram_mtproto_session: the GramJS StringSession for MTProto file
 *     streaming. Stored here (not in RAM or a file) so the session survives
 *     Replit restarts/redeploys without requiring TELEGRAM_MTPROTO_SESSION env.
 *
 * This table is purely ADDITIVE — it does not modify any existing table.
 */
export const appSecretsTable = pgTable("app_secrets", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type AppSecret = typeof appSecretsTable.$inferSelect;
