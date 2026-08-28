import {
  pgTable, uuid, text, boolean, integer, doublePrecision, timestamp, index,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * custom_roles
 * Dynamic badge/role definitions created by admin/owner.
 * Each row defines a named role with cosmetic settings, feature permissions,
 * allowed upload types, and creator revenue-share rates.
 */
export const customRolesTable = pgTable(
  "custom_roles",
  {
    id:          uuid("id").defaultRandom().primaryKey(),
    name:        text("name").notNull().unique(),
    emoji:       text("emoji"),
    color:       text("color").notNull().default("#6366f1"),
    description: text("description"),
    isActive:    boolean("is_active").notNull().default(true),
    priority:    integer("priority").notNull().default(0),

    // ── Feature permissions ──────────────────────────────────────────────────
    permDashboard:        boolean("perm_dashboard").notNull().default(false),
    permUploadVideo:      boolean("perm_upload_video").notNull().default(false),
    permMyVideo:          boolean("perm_my_video").notNull().default(false),
    permLeaderboard:      boolean("perm_leaderboard").notNull().default(true),
    permCreatorDashboard: boolean("perm_creator_dashboard").notNull().default(false),
    /** Full access to all videos (including premium) without purchase. */
    permVideoFullAccess:  boolean("perm_video_full_access").notNull().default(false),

    // ── Upload type access (comma-separated: "free,premium,bundle") ──────────
    uploadTypes: text("upload_types").notNull().default("free"),

    // ── Revenue sharing ──────────────────────────────────────────────────────
    /** Creator keeps this % of each premium video sale (0–100). */
    creatorSharePercent:   doublePrecision("creator_share_percent").notNull().default(50),
    /** Platform keeps the rest. Stored for audit; always = 100 − creatorSharePercent. */
    platformSharePercent:  doublePrecision("platform_share_percent").notNull().default(50),

    createdBy:  uuid("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt:  timestamp("created_at").notNull().defaultNow(),
    updatedAt:  timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ([
    index("custom_roles_priority_idx").on(t.priority),
    index("custom_roles_is_active_idx").on(t.isActive),
  ]),
);

/**
 * user_custom_roles
 * Assigns one or more custom roles to a user.
 */
export const userCustomRolesTable = pgTable(
  "user_custom_roles",
  {
    id:         uuid("id").defaultRandom().primaryKey(),
    userId:     uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    roleId:     uuid("role_id").notNull().references(() => customRolesTable.id, { onDelete: "cascade" }),
    assignedBy: uuid("assigned_by").references(() => usersTable.id, { onDelete: "set null" }),
    assignedAt: timestamp("assigned_at").notNull().defaultNow(),
  },
  (t) => ([
    index("user_custom_roles_user_idx").on(t.userId),
    index("user_custom_roles_role_idx").on(t.roleId),
  ]),
);

export type CustomRole    = typeof customRolesTable.$inferSelect;
export type NewCustomRole = typeof customRolesTable.$inferInsert;
export type UserCustomRole    = typeof userCustomRolesTable.$inferSelect;
export type NewUserCustomRole = typeof userCustomRolesTable.$inferInsert;
