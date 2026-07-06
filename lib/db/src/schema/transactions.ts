import { pgTable, serial, integer, doublePrecision, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const transactionTypeEnum = pgEnum("transaction_type", ["topup", "subscription", "purchase", "adjustment"]);

export const transactionsTable = pgTable("transactions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  type: transactionTypeEnum("type").notNull(),
  amount: doublePrecision("amount").notNull(),
  description: text("description").notNull(),
  referenceId: integer("reference_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Transaction = typeof transactionsTable.$inferSelect;
