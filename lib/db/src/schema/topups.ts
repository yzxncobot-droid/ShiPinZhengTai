import { pgTable, serial, integer, doublePrecision, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const topupStatusEnum = pgEnum("topup_status", ["pending", "confirmed", "denied"]);

export const topupsTable = pgTable("topups", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  amount: doublePrecision("amount").notNull(),
  paymentProof: text("payment_proof"),
  status: topupStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertTopupSchema = createInsertSchema(topupsTable).omit({ id: true, createdAt: true, updatedAt: true, status: true });
export type InsertTopup = z.infer<typeof insertTopupSchema>;
export type Topup = typeof topupsTable.$inferSelect;
