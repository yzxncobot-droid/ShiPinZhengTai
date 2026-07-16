import {
  pgTable, uuid, doublePrecision, text, timestamp, pgEnum, index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const withdrawalStatusEnum = pgEnum("withdrawal_status", [
  "pending", "approved", "rejected", "processing", "completed",
]);

export const withdrawalsTable = pgTable(
  "withdrawals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    amount: doublePrecision("amount").notNull(),
    method: text("method").notNull().default("bank"),
    accountName: text("account_name"),
    accountNumber: text("account_number"),
    bankName: text("bank_name"),
    notes: text("notes"),
    status: withdrawalStatusEnum("status").notNull().default("pending"),
    processedBy: uuid("processed_by").references(() => usersTable.id),
    processedAt: timestamp("processed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdIdx:  index("withdrawals_user_id_idx").on(t.userId),
    statusIdx:  index("withdrawals_status_idx").on(t.status),
    createdIdx: index("withdrawals_created_at_idx").on(t.createdAt),
  }),
);

export const insertWithdrawalSchema = createInsertSchema(withdrawalsTable).omit({
  id: true, createdAt: true, updatedAt: true, status: true, processedBy: true, processedAt: true,
});
export type InsertWithdrawal = z.infer<typeof insertWithdrawalSchema>;
export type Withdrawal = typeof withdrawalsTable.$inferSelect;
