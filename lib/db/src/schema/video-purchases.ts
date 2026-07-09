import { pgTable, serial, integer, timestamp, doublePrecision, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { videosTable } from "./videos";

/** Records a one-time purchase of a single premium video by a user. */
export const videoPurchasesTable = pgTable(
  "video_purchases",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    videoId: integer("video_id").notNull().references(() => videosTable.id, { onDelete: "cascade" }),
    price: doublePrecision("price").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    userVideoUnique: unique().on(table.userId, table.videoId),
  }),
);

export type VideoPurchase = typeof videoPurchasesTable.$inferSelect;
