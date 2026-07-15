import { pgTable, serial, text, integer, boolean, timestamp, doublePrecision, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { videosTable } from "./videos";
import { usersTable } from "./users";

/**
 * A purchasable pack of 1-10 videos sold at a discount. Bundles are
 * purchase-only: access to a bundle's videos is granted exclusively via
 * `bundlePurchasesTable`, never via a subscription (see `videosTable.bundleExclusive`).
 */
export const bundlesTable = pgTable("bundles", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  thumbnail: text("thumbnail"),
  price: doublePrecision("price").notNull(),
  originalPrice: doublePrecision("original_price"),
  badge: text("badge"), // e.g. "BEST SELLER", "POPULAR", "NEW", "VALUE PACK"
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const bundleVideosTable = pgTable(
  "bundle_videos",
  {
    id: serial("id").primaryKey(),
    bundleId: integer("bundle_id").notNull().references(() => bundlesTable.id, { onDelete: "cascade" }),
    videoId: integer("video_id").notNull().references(() => videosTable.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => ({
    bundleVideoUnique: unique().on(table.bundleId, table.videoId),
  }),
);

/** Records a one-time purchase of a bundle by a user; grants access to all its videos. */
export const bundlePurchasesTable = pgTable(
  "bundle_purchases",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    bundleId: integer("bundle_id").notNull().references(() => bundlesTable.id, { onDelete: "cascade" }),
    price: doublePrecision("price").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    userBundleUnique: unique().on(table.userId, table.bundleId),
  }),
);

export const insertBundleSchema = createInsertSchema(bundlesTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertBundle = z.infer<typeof insertBundleSchema>;
export type Bundle = typeof bundlesTable.$inferSelect;
export type BundleVideo = typeof bundleVideosTable.$inferSelect;
export type BundlePurchase = typeof bundlePurchasesTable.$inferSelect;
