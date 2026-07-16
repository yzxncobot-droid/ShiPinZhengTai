import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { videosTable } from "./videos";

export const commentsTable = pgTable(
  "comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    videoId: uuid("video_id").notNull().references(() => videosTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    videoIdIdx: index("comments_video_id_idx").on(t.videoId),
    userIdIdx:  index("comments_user_id_idx").on(t.userId),
    createdIdx: index("comments_created_at_idx").on(t.createdAt),
  }),
);

export type Comment = typeof commentsTable.$inferSelect;
