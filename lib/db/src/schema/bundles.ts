import {
  pgTable, uuid, text, integer, boolean, timestamp, doublePrecision, unique, index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { videosTable } from "./videos";
import { usersTable } from "./users";

/**
 * A purchasable pack of 1-10 videos sold at a discount. Bundles are
 * purchase-only: access to a bundle's videos is granted exclusively via
 * `bundlePurchasesTable`, never via a subscription (see `videosTable.visibility`).
 */
export const bundlesTable = pgTable(
  "bundles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    description: text("description"),
    thumbnail: text("thumbnail"),
    banner: text("banner"),
    price: doublePrecision("price").notNull(),
    originalPrice: doublePrecision("original_price"),
    badge: text("badge"),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    deletedAtIdx: index("bundles_deleted_at_idx").on(t.deletedAt),
  }),
);

export const bundleVideosTable = pgTable(
  "bundle_videos",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bundleId: uuid("bundle_id").notNull().references(() => bundlesTable.id, { onDelete: "cascade" }),
    videoId: uuid("video_id").notNull().references(() => videosTable.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => ([
    unique().on(table.bundleId, table.videoId),
    index("bundle_videos_bundle_id_idx").on(table.bundleId),
  ]),
);

/** Records a one-time purchase of a bundle by a user; grants access to all its videos. */
export const bundlePurchasesTable = pgTable(
  "bundle_purchases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    bundleId: uuid("bundle_id").notNull().references(() => bundlesTable.id, { onDelete: "cascade" }),
    price: doublePrecision("price").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ([
    unique().on(table.userId, table.bundleId),
    index("bundle_purchases_user_id_idx").on(table.userId),
  ]),
);

export const insertBundleSchema = createInsertSchema(bundlesTable).omit({
  id: true, createdAt: true, updatedAt: true, deletedAt: true,
});
export type InsertBundle = z.infer<typeof insertBundleSchema>;
export type Bundle = typeof bundlesTable.$inferSelect;
export type BundleVideo = typeof bundleVideosTable.$inferSelect;
export type BundlePurchase = typeof bundlePurchasesTable.$inferSelect;
