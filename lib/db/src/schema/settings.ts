import { pgTable, uuid, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const settingsTable = pgTable("settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  siteName: text("site_name").notNull().default("Yzu视频"),
  tagline: text("tagline"),
  siteDescription: text("site_description"),
  logo: text("logo"),
  favicon: text("favicon"),
  banner: text("banner"),
  qrisImage: text("qris_image"),
  whatsappLink: text("whatsapp_link"),
  telegramLink: text("telegram_link"),
  discordLink: text("discord_link"),
  instagramLink: text("instagram_link"),
  facebookLink: text("facebook_link"),
  youtubeLink: text("youtube_link"),
  tiktokLink: text("tiktok_link"),
  chatLogo: text("chat_logo"),
  faq: text("faq"),
  footerText: text("footer_text"),
  metaTitle: text("meta_title"),
  googleAnalyticsId: text("google_analytics_id"),
  googleSearchConsoleId: text("google_search_console_id"),

  // ── Maintenance Mode ────────────────────────────────────────────────────────
  maintenanceEnabled:     boolean("maintenance_enabled").notNull().default(false),
  maintenanceTitle:       text("maintenance_title"),
  maintenanceDescription: text("maintenance_description"),
  maintenanceImage:       text("maintenance_image"),
  maintenanceButtonText:  text("maintenance_button_text"),
  maintenanceRedirectUrl: text("maintenance_redirect_url"),
  maintenanceEta:         timestamp("maintenance_eta"),
  maintenanceCountdown:   boolean("maintenance_countdown").notNull().default(false),
  maintenanceUpdatedAt:   timestamp("maintenance_updated_at"),
  maintenanceUpdatedBy:   uuid("maintenance_updated_by"),
});

export type Settings = typeof settingsTable.$inferSelect;
