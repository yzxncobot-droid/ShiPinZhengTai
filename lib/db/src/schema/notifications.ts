import { pgTable, uuid, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const notificationsTable = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    message: text("message").notNull(),
    type: text("type").notNull().default("info"),
    isRead: boolean("is_read").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdIdx:   index("notifications_user_id_idx").on(t.userId),
    isReadIdx:   index("notifications_is_read_idx").on(t.userId, t.isRead),
    createdIdx:  index("notifications_created_at_idx").on(t.createdAt),
  }),
);

export type Notification = typeof notificationsTable.$inferSelect;
