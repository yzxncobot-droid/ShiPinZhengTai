import {
  pgTable, uuid, text, boolean, timestamp,
  doublePrecision, pgEnum, uniqueIndex, index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Application roles:
 *  meril  – standard viewer / subscriber (the default consumer role)
 *  admin  – content manager; can upload, edit, moderate
 *  owner  – full access including payments and role management
 *
 * Note: the legacy "user" value is retained so existing rows aren't broken.
 * New registrations default to "meril". Frontend should treat "user" === "meril".
 */
export const roleEnum = pgEnum("role", ["user", "meril", "moderator", "verified_creator", "admin", "owner"]);

export const subscriptionStatusEnum = pgEnum("subscription_status_enum", [
  "none", "active", "expired",
]);

export const usersTable = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    // ── Identity ───────────────────────────────────────────────────────
    username: text("username").notNull().unique(),
    /** Optional – kept for backward compat; new registrations may omit it. */
    email: text("email").unique(),
    passwordHash: text("password_hash").notNull(),
    role: roleEnum("role").notNull().default("meril"),
    avatar: text("avatar"),
    isBanned: boolean("is_banned").notNull().default(false),

    // ── Wallet (denormalised fast-access cache) ────────────────────────
    walletBalance: doublePrecision("wallet_balance").notNull().default(0),
    totalTopup: doublePrecision("total_topup").notNull().default(0),
    totalSpent: doublePrecision("total_spent").notNull().default(0),

    // ── Subscription cache ─────────────────────────────────────────────
    /** Denormalised status – kept in sync by subscription routes. */
    subscriptionStatus: subscriptionStatusEnum("subscription_status").notNull().default("none"),
    /** UTC expiry of the current subscription (null when none/expired). */
    subscriptionExpiry: timestamp("subscription_expiry"),

    // ── Verification badge (denormalised for fast JOIN-free reads) ─────
    /** "blue" | "gold" | "sulthan" | null — kept in sync by verification routes */
    verificationBadge: text("verification_badge"),

    // ── Referral ──────────────────────────────────────────────────────
    /** Unique code that users can share to earn credits. Auto-generated on insert. */
    referralCode: text("referral_code").unique(),
    /** The user who referred this account (null if organic signup). */
    referredBy: uuid("referred_by"),

    // ── Creator Badge System ──────────────────────────────────────────────────
    /** true → user can upload videos */
    creatorBadge:    boolean("creator_badge").notNull().default(false),
    /** true → user can upload + access My Video dashboard (requires creatorBadge) */
    verifiedCreator: boolean("verified_creator").notNull().default(false),

    // ── Profile extras ────────────────────────────────────────────────────────
    displayName: text("display_name"),
    bio:         text("bio"),
    banner:      text("banner"),

    // ── Soft delete ───────────────────────────────────────────────────
    deletedAt: timestamp("deleted_at"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    usernameIdx:     uniqueIndex("users_username_idx").on(t.username),
    emailIdx:        uniqueIndex("users_email_idx").on(t.email),
    referralCodeIdx: uniqueIndex("users_referral_code_idx").on(t.referralCode),
    roleIdx:         index("users_role_idx").on(t.role),
    createdAtIdx:    index("users_created_at_idx").on(t.createdAt),
    deletedAtIdx:    index("users_deleted_at_idx").on(t.deletedAt),
  }),
);

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true, createdAt: true, updatedAt: true, deletedAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;

/** Roles that have any elevated privilege. */
export const STAFF_ROLES = ["moderator", "admin", "owner"] as const;
/** All known roles (including legacy "user"). */
export type UserRole = "user" | "meril" | "moderator" | "verified_creator" | "admin" | "owner";
