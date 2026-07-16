import {
  pgTable, uuid, doublePrecision, text, timestamp, pgEnum, index,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const transactionTypeEnum = pgEnum("transaction_type", [
  "topup", "subscription", "purchase", "adjustment",
  "refund", "bonus", "revenue_share",
]);

/**
 * transactions — lightweight activity log for every balance change.
 * For a full double-entry ledger see wallet_transactions.
 */
export const transactionsTable = pgTable(
  "transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    type: transactionTypeEnum("type").notNull(),
    amount: doublePrecision("amount").notNull(),    // positive = credit, negative = debit
    description: text("description").notNull(),
    referenceId: text("reference_id"),              // UUID of the referenced record (as text)
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdIdx:  index("transactions_user_id_idx").on(t.userId),
    typeIdx:    index("transactions_type_idx").on(t.type),
    createdIdx: index("transactions_created_at_idx").on(t.createdAt),
  }),
);

export type Transaction = typeof transactionsTable.$inferSelect;
