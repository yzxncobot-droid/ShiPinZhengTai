import {
  pgTable, uuid, doublePrecision, text, timestamp, pgEnum, index,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Wallet transaction types:
 *  topup        – user added funds (approved payment)
 *  purchase     – spent on a video or bundle
 *  subscription – spent on a subscription plan
 *  refund       – reversed purchase / denied topup reversed
 *  bonus        – referral bonus or promotional credit
 *  revenue_share – creator earnings distributed to owner
 *  adjustment   – manual admin correction
 */
export const walletTxTypeEnum = pgEnum("wallet_tx_type", [
  "topup", "purchase", "subscription", "refund",
  "bonus", "revenue_share", "adjustment",
]);

/**
 * wallets – one row per user, tracks the canonical balance.
 * The actual authoritative balance is `usersTable.walletBalance`; this
 * table is a secondary ledger for auditing and dispute resolution.
 */
export const walletsTable = pgTable(
  "wallets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().unique().references(() => usersTable.id, { onDelete: "cascade" }),
    balance: doublePrecision("balance").notNull().default(0),
    totalEarned: doublePrecision("total_earned").notNull().default(0),
    totalSpent: doublePrecision("total_spent").notNull().default(0),
    lastTransactionAt: timestamp("last_transaction_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdIdx: index("wallets_user_id_idx").on(t.userId),
  }),
);

/**
 * wallet_transactions – immutable ledger of every balance change.
 * Positive amount = credit (topup, bonus, refund).
 * Negative amount = debit (purchase, subscription).
 */
export const walletTransactionsTable = pgTable(
  "wallet_transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    type: walletTxTypeEnum("type").notNull(),
    amount: doublePrecision("amount").notNull(),           // positive = credit, negative = debit
    balanceAfter: doublePrecision("balance_after").notNull(),
    description: text("description").notNull(),
    referenceType: text("reference_type"),                 // "payment", "video", "bundle", "subscription", etc.
    referenceId: text("reference_id"),                     // UUID of the referenced record (as text)
    createdBy: uuid("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdIdx:   index("wallet_tx_user_id_idx").on(t.userId),
    typeIdx:     index("wallet_tx_type_idx").on(t.type),
    createdIdx:  index("wallet_tx_created_at_idx").on(t.createdAt),
  }),
);

export type Wallet = typeof walletsTable.$inferSelect;
export type WalletTransaction = typeof walletTransactionsTable.$inferSelect;
