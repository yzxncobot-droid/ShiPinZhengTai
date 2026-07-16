import {
  pgTable, uuid, text, integer, boolean, timestamp, doublePrecision, index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

/**
 * subscription_plans (exported as both subscriptionsTable and subscriptionPlansTable).
 * Defines the purchasable tier catalogue; admin/owner can create/disable plans.
 */
export const subscriptionsTable = pgTable("subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  price: doublePrecision("price").notNull(),
  durationDays: integer("duration_days").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** Alias — matches the spec table name "subscription_plans". */
export const subscriptionPlansTable = subscriptionsTable;

/**
 * user_subscriptions — a purchased subscription period for a user.
 * A user can have multiple rows (history); only the most recent active one counts.
 */
export const userSubscriptionsTable = pgTable(
  "user_subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    subscriptionId: uuid("subscription_id").notNull().references(() => subscriptionsTable.id, { onDelete: "cascade" }),
    startDate: timestamp("start_date").notNull().defaultNow(),
    endDate: timestamp("end_date").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    /** Amount paid at purchase time (snapshot). */
    pricePaid: doublePrecision("price_paid"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdIdx:   index("user_sub_user_id_idx").on(t.userId),
    activeIdx:   index("user_sub_active_idx").on(t.userId, t.isActive),
    endDateIdx:  index("user_sub_end_date_idx").on(t.endDate),
  }),
);

export const insertSubscriptionSchema = createInsertSchema(subscriptionsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Subscription = typeof subscriptionsTable.$inferSelect;
export type SubscriptionPlan = Subscription;
export type UserSubscription = typeof userSubscriptionsTable.$inferSelect;
