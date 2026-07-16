import { pgTable, uuid, timestamp, doublePrecision, unique, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { videosTable } from "./videos";

/** Records a one-time purchase of a single premium video by a user. */
export const videoPurchasesTable = pgTable(
  "video_purchases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    videoId: uuid("video_id").notNull().references(() => videosTable.id, { onDelete: "cascade" }),
    price: doublePrecision("price").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ([
    unique().on(table.userId, table.videoId),
    index("video_purchases_user_id_idx").on(table.userId),
    index("video_purchases_video_id_idx").on(table.videoId),
  ]),
);

export type VideoPurchase = typeof videoPurchasesTable.$inferSelect;
