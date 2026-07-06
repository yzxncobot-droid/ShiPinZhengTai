import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { videosTable } from "./videos";

export const commentsTable = pgTable("comments", {
  id: serial("id").primaryKey(),
  videoId: integer("video_id").notNull().references(() => videosTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Comment = typeof commentsTable.$inferSelect;
