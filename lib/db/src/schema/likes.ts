import { pgTable, serial, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { videosTable } from "./videos";

export const likesTable = pgTable("likes", {
  id: serial("id").primaryKey(),
  videoId: integer("video_id").notNull().references(() => videosTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  unique().on(t.videoId, t.userId),
]);

export type Like = typeof likesTable.$inferSelect;
