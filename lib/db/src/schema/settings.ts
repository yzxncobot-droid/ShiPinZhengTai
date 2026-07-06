import { pgTable, serial, text } from "drizzle-orm/pg-core";

export const settingsTable = pgTable("settings", {
  id: serial("id").primaryKey(),
  siteName: text("site_name").notNull().default("Yzu视频"),
  siteDescription: text("site_description"),
  logo: text("logo"),
  favicon: text("favicon"),
  banner: text("banner"),
  qrisImage: text("qris_image"),
  whatsappLink: text("whatsapp_link"),
  chatLogo: text("chat_logo"),
  faq: text("faq"),
  footerText: text("footer_text"),
});

export type Settings = typeof settingsTable.$inferSelect;
