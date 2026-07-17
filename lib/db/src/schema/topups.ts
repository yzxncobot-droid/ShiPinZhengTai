import {
  pgTable, uuid, doublePrecision, text, timestamp, pgEnum, index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { paymentProofsTable } from "./payment-proofs";

export const topupStatusEnum = pgEnum("topup_status", ["pending", "confirmed", "denied"]);

/**
 * topups / payments — one row per top-up request.
 * The `paymentProofId` links to the separately stored proof image.
 * `paymentProof` (text) is kept for backward compat with existing rows.
 */
export const topupsTable = pgTable(
  "topups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    amount: doublePrecision("amount").notNull(),

    /** Legacy inline proof URL — prefer paymentProofId for new records. */
    paymentProof: text("payment_proof"),

    /** Foreign key to the dedicated proof record (preferred). */
    paymentProofId: uuid("payment_proof_id").references(() => paymentProofsTable.id, { onDelete: "set null" }),

    status: topupStatusEnum("status").notNull().default("pending"),

    /**
     * Amount the user claims to have transferred.
     * Recorded at submission time; compared against `amount` to derive `amountMatchStatus`.
     */
    transferAmount: doublePrecision("transfer_amount"),

    /**
     * Computed at submission time:
     *  - "match"    → transferAmount === amount  (eligible for confirmation)
     *  - "mismatch" → amounts differ (admin may only deny)
     */
    amountMatchStatus: text("amount_match_status").default("match"), // 'match' | 'mismatch'

    /** Staff who confirmed/denied. */
    reviewedBy: uuid("reviewed_by").references(() => usersTable.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at"),
    reviewNote: text("review_note"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdIdx:  index("topups_user_id_idx").on(t.userId),
    statusIdx:  index("topups_status_idx").on(t.status),
    createdIdx: index("topups_created_at_idx").on(t.createdAt),
  }),
);

/** Alias — "payments" is the user-facing name for topups. */
export const paymentsTable = topupsTable;

export const insertTopupSchema = createInsertSchema(topupsTable).omit({
  id: true, createdAt: true, updatedAt: true, status: true,
  reviewedBy: true, reviewedAt: true, reviewNote: true,
});
export type InsertTopup = z.infer<typeof insertTopupSchema>;
export type Topup = typeof topupsTable.$inferSelect;
/** Alias */
export type Payment = Topup;
