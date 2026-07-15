import { pgTable, serial, text, integer, boolean, timestamp, doublePrecision, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { categoriesTable } from "./categories";

/** Legacy type enum – kept for API compat; derived from visibility on write. */
export const videoTypeEnum = pgEnum("video_type", ["free", "premium"]);

/**
 * Primary visibility control:
 *  - public       → free, visible everywhere
 *  - premium      → requires active subscription or individual purchase
 *  - hidden_bundle → never appears in any listing; accessible only via bundle purchase
 */
export const videoVisibilityEnum = pgEnum("video_visibility", ["public", "premium", "hidden_bundle"]);

export const videosTable = pgTable("videos", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  thumbnail: text("thumbnail"),
  videoUrl: text("video_url").notNull(),
  /** @deprecated use visibility instead; kept for API compat */
  type: videoTypeEnum("type").notNull().default("free"),
  price: doublePrecision("price"),
  views: integer("views").notNull().default(0),
  likes: integer("likes").notNull().default(0),
  downloadable: boolean("downloadable").notNull().default(false),
  isFeatured: boolean("is_featured").notNull().default(false),
  /**
   * Primary visibility flag. Supersedes type + bundleExclusive.
   * Use this for all filtering in queries.
   */
  visibility: videoVisibilityEnum("visibility").notNull().default("public"),
  /** @deprecated use visibility === "hidden_bundle" instead; kept for compat */
  bundleExclusive: boolean("bundle_exclusive").notNull().default(false),
  // CMS fields
  status: text("status").notNull().default("published"), // draft | published | hidden | scheduled
  tags: text("tags"),           // JSON array string
  duration: integer("duration"), // seconds
  scheduledAt: timestamp("scheduled_at"),
  categoryId: integer("category_id").references(() => categoriesTable.id, { onDelete: "set null" }),
  creatorId: integer("creator_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertVideoSchema = createInsertSchema(videosTable).omit({
  id: true, createdAt: true, updatedAt: true, views: true, likes: true,
});
export type InsertVideo = z.infer<typeof insertVideoSchema>;
export type Video = typeof videosTable.$inferSelect;
export type VideoVisibility = "public" | "premium" | "hidden_bundle";

/** Derive the legacy type/bundleExclusive pair from a visibility value. */
export function visibilityToLegacy(visibility: VideoVisibility) {
  return {
    type: visibility === "public" ? ("free" as const) : ("premium" as const),
    bundleExclusive: visibility === "hidden_bundle",
  };
}

/** Derive visibility from legacy type + bundleExclusive fields. */
export function legacyToVisibility(type: "free" | "premium", bundleExclusive: boolean): VideoVisibility {
  if (bundleExclusive) return "hidden_bundle";
  if (type === "premium") return "premium";
  return "public";
}
