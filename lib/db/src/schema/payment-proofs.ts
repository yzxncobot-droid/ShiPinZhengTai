import {
  pgTable, serial, integer, text, timestamp, pgEnum, index,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const proofStatusEnum = pgEnum("proof_status", [
  "pending",   // submitted, awaiting review
  "approved",  // owner/admin approved → wallet credited
  "denied",    // owner/admin denied → no credit
]);

/**
 * payment_proofs – stores raw evidence files submitted by users for
 * manual payment verification. One proof can back multiple top-up
 * attempts (unusual) or be the sole evidence for a single payment.
 *
 * The companion payments/topups table holds the actual amount + status.
 */
export const paymentProofsTable = pgTable(
  "payment_proofs",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),

    /** Public URL of the uploaded screenshot/receipt in Supabase yzx/payments/. */
    imageUrl: text("image_url").notNull(),

    /** Amount claimed by the user (owner may verify or override). */
    claimedAmount: text("claimed_amount"),

    status: proofStatusEnum("status").notNull().default("pending"),

    /** Staff member who reviewed this proof. */
    reviewedBy: integer("reviewed_by").references(() => usersTable.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at"),
    reviewNote: text("review_note"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdIdx:  index("payment_proofs_user_id_idx").on(t.userId),
    statusIdx:  index("payment_proofs_status_idx").on(t.status),
    createdIdx: index("payment_proofs_created_at_idx").on(t.createdAt),
  }),
);

export type PaymentProof = typeof paymentProofsTable.$inferSelect;
