import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const auditLogsTable = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => usersTable.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entity: text("entity"),
    entityId: text("entity_id"),
    details: text("details"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdIdx:  index("audit_logs_user_id_idx").on(t.userId),
    actionIdx:  index("audit_logs_action_idx").on(t.action),
    createdIdx: index("audit_logs_created_at_idx").on(t.createdAt),
  }),
);

export type AuditLog = typeof auditLogsTable.$inferSelect;
