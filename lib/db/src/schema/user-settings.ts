import { pgTable, uuid, boolean, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * user_settings – per-user preference store.
 * One row per user, created on first save.
 */
export const userSettingsTable = pgTable("user_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().unique().references(() => usersTable.id, { onDelete: "cascade" }),

  // Notification preferences
  notificationsEnabled: boolean("notifications_enabled").notNull().default(true),
  emailNotifications: boolean("email_notifications").notNull().default(true),
  pushNotifications: boolean("push_notifications").notNull().default(true),

  // Privacy
  profileVisibility: text("profile_visibility").notNull().default("public"), // public | private

  // Localisation
  language: text("language").notNull().default("id"),     // BCP-47 locale tag
  timezone: text("timezone").notNull().default("Asia/Jakarta"),

  // Appearance
  theme: text("theme").notNull().default("system"),       // light | dark | system

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type UserSettings = typeof userSettingsTable.$inferSelect;
