import { pgTable, serial, text, integer, boolean, timestamp, doublePrecision, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { categoriesTable } from "./categories";

export const videoTypeEnum = pgEnum("video_type", ["free", "premium"]);

export const videosTable = pgTable("videos", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  thumbnail: text("thumbnail"),
  videoUrl: text("video_url").notNull(),
  type: videoTypeEnum("type").notNull().default("free"),
  price: doublePrecision("price"),
  views: integer("views").notNull().default(0),
  likes: integer("likes").notNull().default(0),
  downloadable: boolean("downloadable").notNull().default(false),
  isFeatured: boolean("is_featured").notNull().default(false),
  categoryId: integer("category_id").references(() => categoriesTable.id, { onDelete: "set null" }),
  creatorId: integer("creator_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertVideoSchema = createInsertSchema(videosTable).omit({ id: true, createdAt: true, updatedAt: true, views: true, likes: true });
export type InsertVideo = z.infer<typeof insertVideoSchema>;
export type Video = typeof videosTable.$inferSelect;
