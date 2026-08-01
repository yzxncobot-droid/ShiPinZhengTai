import { pgTable, uuid, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const notificationsTable = pgTable(
  "notifications",
  {
    id:            uuid("id").defaultRandom().primaryKey(),
    userId:        uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    title:         text("title").notNull(),
    message:       text("message").notNull(),
    type:          text("type").notNull().default("info"),         // info | success | warning | promo
    category:      text("category").notNull().default("system"),   // system | social | activity | announcement | payment
    isRead:        boolean("is_read").notNull().default(false),
    actorId:       uuid("actor_id").references(() => usersTable.id, { onDelete: "set null" }),
    actorUsername: text("actor_username"),
    actorAvatar:   text("actor_avatar"),
    referenceType: text("reference_type"),  // "follow" | "message" | "bundle" | "payment" | "video" | etc.
    referenceId:   text("reference_id"),
    actionUrl:     text("action_url"),
    createdAt:     timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdIdx:    index("notifications_user_id_idx").on(t.userId),
    isReadIdx:    index("notifications_is_read_idx").on(t.userId, t.isRead),
    createdIdx:   index("notifications_created_at_idx").on(t.createdAt),
    categoryIdx:  index("notifications_category_idx").on(t.userId, t.category),
  }),
);

export type Notification = typeof notificationsTable.$inferSelect;
