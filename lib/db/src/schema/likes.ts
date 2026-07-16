import { pgTable, uuid, timestamp, unique, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { videosTable } from "./videos";

export const likesTable = pgTable(
  "likes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    videoId: uuid("video_id").notNull().references(() => videosTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ([
    unique().on(t.videoId, t.userId),
    index("likes_video_id_idx").on(t.videoId),
    index("likes_user_id_idx").on(t.userId),
  ]),
);

export type Like = typeof likesTable.$inferSelect;
