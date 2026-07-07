import { pgTable, serial, integer, doublePrecision, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const withdrawalStatusEnum = pgEnum("withdrawal_status", [
  "pending", "approved", "rejected", "processing", "completed",
]);

export const withdrawalsTable = pgTable("withdrawals", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  amount: doublePrecision("amount").notNull(),
  method: text("method").notNull().default("bank"),
  accountName: text("account_name"),
  accountNumber: text("account_number"),
  bankName: text("bank_name"),
  notes: text("notes"),
  status: withdrawalStatusEnum("status").notNull().default("pending"),
  processedBy: integer("processed_by").references(() => usersTable.id),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertWithdrawalSchema = createInsertSchema(withdrawalsTable).omit({
  id: true, createdAt: true, updatedAt: true, status: true, processedBy: true, processedAt: true,
});
export type InsertWithdrawal = z.infer<typeof insertWithdrawalSchema>;
export type Withdrawal = typeof withdrawalsTable.$inferSelect;
