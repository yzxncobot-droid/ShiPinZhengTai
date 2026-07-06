import { pgTable, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { videosTable } from "./videos";

export const viewsTable = pgTable("views", {
  id: serial("id").primaryKey(),
  videoId: integer("video_id").notNull().references(() => videosTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type View = typeof viewsTable.$inferSelect;
