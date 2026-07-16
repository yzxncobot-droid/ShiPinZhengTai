import { pgTable, uuid, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { videosTable } from "./videos";

export const viewsTable = pgTable(
  "views",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    videoId: uuid("video_id").notNull().references(() => videosTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    videoIdIdx:  index("views_video_id_idx").on(t.videoId),
    userIdIdx:   index("views_user_id_idx").on(t.userId),
    createdIdx:  index("views_created_at_idx").on(t.createdAt),
  }),
);

export type View = typeof viewsTable.$inferSelect;
