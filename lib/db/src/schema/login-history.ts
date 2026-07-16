import { pgTable, uuid, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * login_history – audit trail of every authentication attempt.
 * Records both successful and failed logins for security monitoring.
 */
export const loginHistoryTable = pgTable(
  "login_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Null for failed attempts where the user wasn't found. */
    userId: uuid("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
    /** Username or email that was attempted. */
    identifier: text("identifier").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    success: boolean("success").notNull().default(false),
    /** Reason for failure (e.g. "invalid_password", "banned", "not_found"). */
    failureReason: text("failure_reason"),
    /** The Redis session ID (jti) issued on successful login. */
    sessionId: text("session_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdIdx:   index("login_history_user_id_idx").on(t.userId),
    ipIdx:       index("login_history_ip_idx").on(t.ipAddress),
    createdIdx:  index("login_history_created_at_idx").on(t.createdAt),
    successIdx:  index("login_history_success_idx").on(t.success),
  }),
);

export type LoginHistory = typeof loginHistoryTable.$inferSelect;
