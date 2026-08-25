import {
  pgTable, uuid, text, integer, boolean, timestamp, jsonb,
  doublePrecision, pgEnum, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const achievementRarityEnum = pgEnum("achievement_rarity", [
  "COMMON", "RARE", "EPIC", "LEGENDARY", "SPECIAL",
]);

export const expSourceEnum = pgEnum("exp_source", [
  "login", "watch_video", "like_video", "comment", "send_message",
  "join_group", "achievement", "daily_mission", "upload_video",
  "admin_adjustment", "level_reward",
]);

// ─── user_levels — per-user EXP / level cache ─────────────────────────────────

export const userLevelsTable = pgTable(
  "user_levels",
  {
    id:              uuid("id").defaultRandom().primaryKey(),
    userId:          uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    totalExp:        integer("total_exp").notNull().default(0),
    currentLevel:    integer("current_level").notNull().default(1),
    /** EXP earned today (reset daily by the service). */
    expToday:        integer("exp_today").notNull().default(0),
    /** UTC date string (YYYY-MM-DD) of the last EXP award — used to reset expToday. */
    expTodayDate:    text("exp_today_date"),
    /** Total EXP earned across the account's lifetime (never decreases). */
    lifetimeExp:     integer("lifetime_exp").notNull().default(0),
    lastExpActivity: timestamp("last_exp_activity"),
    /** Login streak in days. */
    streakDays:      integer("streak_days").notNull().default(0),
    /** UTC date string of the last login day. */
    lastLoginDate:   text("last_login_date"),
    createdAt:       timestamp("created_at").notNull().defaultNow(),
    updatedAt:       timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdIdx:    uniqueIndex("user_levels_user_idx").on(t.userId),
    levelIdx:     index("user_levels_level_idx").on(t.currentLevel),
    totalExpIdx:  index("user_levels_total_exp_idx").on(t.totalExp),
  }),
);

// ─── exp_transactions — immutable ledger of every EXP award ───────────────────

export const expTransactionsTable = pgTable(
  "exp_transactions",
  {
    id:          uuid("id").defaultRandom().primaryKey(),
    userId:      uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    amount:      integer("amount").notNull(),
    source:      expSourceEnum("source").notNull(),
    /** Idempotency key — prevents duplicate awards for the same logical event. */
    referenceId: text("reference_id"),
    metadata:    jsonb("metadata"),
    createdAt:   timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdIdx:     index("exp_transactions_user_idx").on(t.userId),
    createdIdx:    index("exp_transactions_created_idx").on(t.createdAt),
    sourceIdx:     index("exp_transactions_source_idx").on(t.source),
    /** One award per (user, source, reference) — prevents duplicate rewards. */
    uniqueRef:     uniqueIndex("exp_transactions_ref_idx").on(t.userId, t.source, t.referenceId),
  }),
);

// ─── achievements — catalog of unlockable achievements ─────────────────────────

export const achievementsTable = pgTable(
  "achievements",
  {
    id:               uuid("id").defaultRandom().primaryKey(),
    name:             text("name").notNull(),
    description:      text("description").notNull(),
    icon:             text("icon").notNull().default("🏆"),
    rarity:           achievementRarityEnum("rarity").notNull().default("COMMON"),
    /** Type of requirement: "first_watch"|"first_like"|"message_count"|"streak"|
     *  "upload_count"|"watch_count"|"level"|"like_count"|"comment_count"|"group_count" */
    requirementType:  text("requirement_type").notNull(),
    /** Numeric threshold for the requirement. */
    requirementValue: integer("requirement_value").notNull().default(1),
    expReward:        integer("exp_reward").notNull().default(0),
    /** Optional special badge slug granted on unlock. */
    badgeReward:      text("badge_reward"),
    isHidden:         boolean("is_hidden").notNull().default(false),
    isActive:         boolean("is_active").notNull().default(true),
    createdAt:         timestamp("created_at").notNull().defaultNow(),
    updatedAt:         timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    activeIdx:    index("achievements_active_idx").on(t.isActive),
    reqTypeIdx:   index("achievements_req_type_idx").on(t.requirementType),
  }),
);

// ─── user_achievements — unlocked achievements ────────────────────────────────

export const userAchievementsTable = pgTable(
  "user_achievements",
  {
    id:             uuid("id").defaultRandom().primaryKey(),
    userId:         uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    achievementId:  uuid("achievement_id").notNull().references(() => achievementsTable.id, { onDelete: "cascade" }),
    unlockedAt:     timestamp("unlocked_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqueUnlock: uniqueIndex("user_achievements_unique_idx").on(t.userId, t.achievementId),
    userIdx:      index("user_achievements_user_idx").on(t.userId),
  }),
);

// ─── special_badges — admin-defined cosmetic badges ───────────────────────────

export const specialBadgesTable = pgTable(
  "special_badges",
  {
    id:          uuid("id").defaultRandom().primaryKey(),
    name:        text("name").notNull().unique(),
    icon:        text("icon").notNull().default("⭐"),
    color:       text("color").notNull().default("#8b5cf6"),
    description: text("description"),
    isActive:    boolean("is_active").notNull().default(true),
    createdAt:   timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    activeIdx: index("special_badges_active_idx").on(t.isActive),
  }),
);

// ─── user_special_badges — badge assignments ──────────────────────────────────

export const userSpecialBadgesTable = pgTable(
  "user_special_badges",
  {
    id:          uuid("id").defaultRandom().primaryKey(),
    userId:      uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    badgeId:     uuid("badge_id").notNull().references(() => specialBadgesTable.id, { onDelete: "cascade" }),
    assignedBy:  uuid("assigned_by").references(() => usersTable.id, { onDelete: "set null" }),
    assignedAt:  timestamp("assigned_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqueBadge: uniqueIndex("user_special_badges_unique_idx").on(t.userId, t.badgeId),
    userIdx:     index("user_special_badges_user_idx").on(t.userId),
  }),
);

// ─── user_showcase_badges — user-selected display badges (max 5) ──────────────

export const userShowcaseBadgesTable = pgTable(
  "user_showcase_badges",
  {
    id:           uuid("id").defaultRandom().primaryKey(),
    userId:       uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    /** "level" | "special" | "achievement" */
    badgeType:    text("badge_type").notNull(),
    /** FK to special_badges.id or achievements.id (null for level badge). */
    badgeRef:     uuid("badge_ref"),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt:    timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdx:  index("user_showcase_badges_user_idx").on(t.userId),
    orderIdx: index("user_showcase_badges_order_idx").on(t.userId, t.displayOrder),
  }),
);

// ─── user_statistics — aggregate counters ────────────────────────────────────

export const userStatisticsTable = pgTable(
  "user_statistics",
  {
    id:              uuid("id").defaultRandom().primaryKey(),
    userId:          uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    videosWatched:   integer("videos_watched").notNull().default(0),
    videosLiked:     integer("videos_liked").notNull().default(0),
    commentsPosted:  integer("comments_posted").notNull().default(0),
    messagesSent:    integer("messages_sent").notNull().default(0),
    groupsJoined:    integer("groups_joined").notNull().default(0),
    videosUploaded:  integer("videos_uploaded").notNull().default(0),
    updatedAt:       timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdx: uniqueIndex("user_statistics_user_idx").on(t.userId),
  }),
);

// ─── level_rewards — rewards granted at specific levels ──────────────────────

export const levelRewardsTable = pgTable(
  "level_rewards",
  {
    id:          uuid("id").defaultRandom().primaryKey(),
    level:       integer("level").notNull(),
    rewardType:  text("reward_type").notNull().default("profile_frame"),
    rewardValue: text("reward_value"),
    description: text("description"),
    createdAt:   timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    levelIdx: uniqueIndex("level_rewards_level_idx").on(t.level),
  }),
);

// ─── exp_audit_logs — manual admin EXP adjustments ───────────────────────────

export const expAuditLogsTable = pgTable(
  "exp_audit_logs",
  {
    id:        uuid("id").defaultRandom().primaryKey(),
    adminId:   uuid("admin_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    userId:    uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    amount:    integer("amount").notNull(),
    reason:    text("reason").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdx:  index("exp_audit_logs_user_idx").on(t.userId),
    adminIdx: index("exp_audit_logs_admin_idx").on(t.adminId),
  }),
);

// ─── user_privacy_settings — public/private stat visibility ───────────────────

export const userPrivacySettingsTable = pgTable(
  "user_privacy_settings",
  {
    id:                uuid("id").defaultRandom().primaryKey(),
    userId:            uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    showLevel:         boolean("show_level").notNull().default(true),
    showBadges:        boolean("show_badges").notNull().default(true),
    showAchievements:  boolean("show_achievements").notNull().default(true),
    showTotalVideo:    boolean("show_total_video").notNull().default(true),
    showChatCount:     boolean("show_chat_count").notNull().default(false),
    showActivityStats: boolean("show_activity_stats").notNull().default(false),
    updatedAt:         timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdx: uniqueIndex("user_privacy_settings_user_idx").on(t.userId),
  }),
);

// ─── gamification_config — admin-configurable level formula ──────────────────

export const gamificationConfigTable = pgTable(
  "gamification_config",
  {
    id:            uuid("id").defaultRandom().primaryKey(),
    /** Base EXP needed for level 1→2. */
    baseExp:       integer("base_exp").notNull().default(100),
    /** EXP added per level (linear growth step). */
    stepExp:       integer("step_exp").notNull().default(50),
    /** Multiplier applied every `multiplierInterval` levels. */
    growthMultiplier: doublePrecision("growth_multiplier").notNull().default(1.0),
    multiplierInterval: integer("multiplier_interval").notNull().default(5),
    /** 0 = no cap. */
    maxLevel:      integer("max_level").notNull().default(0),
    updatedAt:     timestamp("updated_at").notNull().defaultNow(),
  },
);

// ─── Level badge tier config (admin-configurable) ─────────────────────────────

export const levelBadgeTiersTable = pgTable(
  "level_badge_tiers",
  {
    id:          uuid("id").defaultRandom().primaryKey(),
    name:        text("name").notNull(),
    icon:        text("icon").notNull().default("🆕"),
    color:       text("color").notNull().default("#94a3b8"),
    minLevel:    integer("min_level").notNull().default(1),
    sortOrder:   integer("sort_order").notNull().default(0),
    createdAt:   timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    minLevelIdx: index("level_badge_tiers_min_level_idx").on(t.minLevel),
  }),
);

// ─── Types ─────────────────────────────────────────────────────────────────────

export type UserLevel = typeof userLevelsTable.$inferSelect;
export type ExpTransaction = typeof expTransactionsTable.$inferSelect;
export type Achievement = typeof achievementsTable.$inferSelect;
export type UserAchievement = typeof userAchievementsTable.$inferSelect;
export type SpecialBadge = typeof specialBadgesTable.$inferSelect;
export type UserSpecialBadge = typeof userSpecialBadgesTable.$inferSelect;
export type UserShowcaseBadge = typeof userShowcaseBadgesTable.$inferSelect;
export type UserStatistic = typeof userStatisticsTable.$inferSelect;
export type LevelReward = typeof levelRewardsTable.$inferSelect;
export type ExpAuditLog = typeof expAuditLogsTable.$inferSelect;
export type UserPrivacySetting = typeof userPrivacySettingsTable.$inferSelect;
export type GamificationConfig = typeof gamificationConfigTable.$inferSelect;
export type LevelBadgeTier = typeof levelBadgeTiersTable.$inferSelect;
