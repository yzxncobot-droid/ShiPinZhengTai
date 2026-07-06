import { pgTable, serial, text, integer, boolean, timestamp, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const subscriptionsTable = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  price: doublePrecision("price").notNull(),
  durationDays: integer("duration_days").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const userSubscriptionsTable = pgTable("user_subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  subscriptionId: integer("subscription_id").notNull().references(() => subscriptionsTable.id, { onDelete: "cascade" }),
  startDate: timestamp("start_date").notNull().defaultNow(),
  endDate: timestamp("end_date").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSubscriptionSchema = createInsertSchema(subscriptionsTable).omit({ id: true, createdAt: true });
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Subscription = typeof subscriptionsTable.$inferSelect;
export type UserSubscription = typeof userSubscriptionsTable.$inferSelect;
