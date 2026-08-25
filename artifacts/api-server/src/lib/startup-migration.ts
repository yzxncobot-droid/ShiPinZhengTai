/**
 * Idempotent startup migration — runs once when the API server boots.
 *
 * TWO phases:
 *
 *  runCriticalStartupMigration()
 *    Financial schema (revenue_shares, payout_status enum).
 *    Must succeed before the server accepts any traffic.
 *    Throws on failure so the caller can process.exit(1).
 *
 *  runBestEffortStartupMigration()
 *    Column additions, back-fills, and other non-critical schema tweaks.
 *    Each step runs in its own try/catch; a failure is logged as a warning
 *    but does NOT prevent the server from serving requests.
 */

import { pool } from "@workspace/db";
import { logger } from "./logger";

// ─── helpers ────────────────────────────────────────────────────────────────

/** Runs a SQL statement and swallows errors (logs warning). */
async function runStep(client: any, name: string, sql: string): Promise<void> {
  try {
    await client.query(sql);
    logger.info(`startup-migration: ${name} — OK`);
  } catch (err: any) {
    logger.warn({ err: err?.message }, `startup-migration: ${name} — failed (non-fatal)`);
  }
}

/** Runs a SQL statement and THROWS on failure (for financial schema). */
async function runCriticalStep(client: any, name: string, sql: string): Promise<void> {
  try {
    await client.query(sql);
    logger.info(`startup-migration: ${name} — OK`);
  } catch (err: any) {
    logger.error({ err: err?.message }, `startup-migration: ${name} — FAILED (critical)`);
    throw err;
  }
}

// ─── phase 1: critical financial schema (must succeed before traffic) ────────

/**
 * Creates the payout_status enum and revenue_shares table if they do not
 * exist, and applies all column/constraint migrations to support bundle rows.
 *
 * Runs inside a single client connection and propagates errors — the server
 * entry point must call this before listening and exit(1) on failure.
 */
export async function runCriticalStartupMigration(): Promise<void> {
  const client = await pool.connect();
  try {
    // payout_status enum
    await runCriticalStep(client, "payout_status enum", `
      DO $$ BEGIN
        CREATE TYPE payout_status AS ENUM ('pending', 'paid', 'cancelled');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    // video_purchases — required by revenue_shares FK; create first if absent.
    await runCriticalStep(client, "video_purchases table", `
      CREATE TABLE IF NOT EXISTS video_purchases (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        video_id   uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
        price      double precision NOT NULL,
        created_at timestamp NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, video_id)
      );
      CREATE INDEX IF NOT EXISTS video_purchases_user_id_idx  ON video_purchases(user_id);
      CREATE INDEX IF NOT EXISTS video_purchases_video_id_idx ON video_purchases(video_id);
    `);

    // revenue_shares base table — purchase_id / video_id start nullable so the
    // subsequent ALTER TABLE statements are idempotent on fresh databases too.
    await runCriticalStep(client, "revenue_shares table", `
      CREATE TABLE IF NOT EXISTS revenue_shares (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        purchase_id     uuid REFERENCES video_purchases(id) ON DELETE CASCADE,
        bundle_purchase_id uuid REFERENCES bundle_purchases(id) ON DELETE CASCADE,
        video_id        uuid REFERENCES videos(id) ON DELETE CASCADE,
        creator_id      uuid REFERENCES users(id) ON DELETE SET NULL,
        buyer_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        video_price     double precision NOT NULL,
        creator_share   double precision NOT NULL,
        platform_share  double precision NOT NULL,
        share_rate      double precision NOT NULL,
        creator_role    text NOT NULL,
        payout_status   payout_status NOT NULL DEFAULT 'paid',
        payout_date     timestamp,
        created_at      timestamp NOT NULL DEFAULT NOW()
      );
    `);

    // Ensure purchase_id and video_id are nullable on tables that pre-date
    // the bundle-row support (idempotent; no-op if already nullable).
    await runCriticalStep(client, "revenue_shares purchase_id nullable", `
      ALTER TABLE revenue_shares ALTER COLUMN purchase_id DROP NOT NULL;
    `);
    await runCriticalStep(client, "revenue_shares video_id nullable", `
      ALTER TABLE revenue_shares ALTER COLUMN video_id DROP NOT NULL;
    `);

    // bundle_purchase_id column (idempotent)
    await runCriticalStep(client, "revenue_shares bundle_purchase_id column", `
      ALTER TABLE revenue_shares
        ADD COLUMN IF NOT EXISTS bundle_purchase_id uuid
          REFERENCES bundle_purchases(id) ON DELETE CASCADE;
    `);

    // Integrity constraint: exactly one of purchase_id / bundle_purchase_id
    await runCriticalStep(client, "revenue_shares source check constraint", `
      ALTER TABLE revenue_shares DROP CONSTRAINT IF EXISTS revenue_shares_source_check;
      ALTER TABLE revenue_shares ADD CONSTRAINT revenue_shares_source_check
        CHECK (
          (purchase_id IS NOT NULL AND bundle_purchase_id IS NULL) OR
          (purchase_id IS NULL     AND bundle_purchase_id IS NOT NULL)
        );
    `);

    // Indexes (all idempotent)
    await runCriticalStep(client, "revenue_shares indexes", `
      CREATE INDEX IF NOT EXISTS revenue_shares_purchase_id_idx        ON revenue_shares(purchase_id);
      CREATE INDEX IF NOT EXISTS revenue_shares_bundle_purchase_id_idx ON revenue_shares(bundle_purchase_id);
      CREATE INDEX IF NOT EXISTS revenue_shares_creator_id_idx         ON revenue_shares(creator_id);
      CREATE INDEX IF NOT EXISTS revenue_shares_buyer_id_idx           ON revenue_shares(buyer_id);
      CREATE INDEX IF NOT EXISTS revenue_shares_video_id_idx           ON revenue_shares(video_id);
      CREATE INDEX IF NOT EXISTS revenue_shares_created_at_idx         ON revenue_shares(created_at);
      CREATE INDEX IF NOT EXISTS revenue_shares_payout_status_idx      ON revenue_shares(payout_status);
    `);
  } finally {
    client.release();
  }
}

// ─── phase 2: best-effort schema tweaks (non-critical) ───────────────────────

/**
 * Applies column additions, back-fills, and other non-critical schema patches.
 * Failures are logged as warnings but do NOT prevent the server from serving
 * requests.
 */
export async function runBestEffortStartupMigration(): Promise<void> {
  const client = await pool.connect();
  try {
    // ── 0. role enum — add new values ───────────────────────────────────────
    await runStep(client, "role enum: add 'creator'", `
      ALTER TYPE role ADD VALUE IF NOT EXISTS 'creator';
    `);

    // ── 1. videos table columns ─────────────────────────────────────────────
    await runStep(client, "videos columns", `
      ALTER TABLE videos ADD COLUMN IF NOT EXISTS video_source_type text NOT NULL DEFAULT 'upload';
      ALTER TABLE videos ADD COLUMN IF NOT EXISTS video_file_path text;
      ALTER TABLE videos ADD COLUMN IF NOT EXISTS uploader_type text;
      ALTER TABLE videos ADD COLUMN IF NOT EXISTS thumbnail_path text;
      ALTER TABLE videos ADD COLUMN IF NOT EXISTS storage_folder text;
      ALTER TABLE videos ADD COLUMN IF NOT EXISTS bucket_name text;
      ALTER TABLE videos ADD COLUMN IF NOT EXISTS video_storage_provider text;
      ALTER TABLE videos ADD COLUMN IF NOT EXISTS bunny_video_id text;
      ALTER TABLE videos ADD COLUMN IF NOT EXISTS bunny_playback_url text;
      ALTER TABLE videos ADD COLUMN IF NOT EXISTS bunny_library_id text;
      ALTER TABLE videos ADD COLUMN IF NOT EXISTS storage_type text;
    `);

    // ── 2. videos storage_type back-fill ────────────────────────────────────
    await runStep(client, "videos storage_type back-fill", `
      UPDATE videos
      SET storage_type = CASE
        WHEN uploader_type IN ('creator', 'verified_creator') THEN 'PUBLIC'
        WHEN uploader_type = 'owner'                         THEN 'OWNER'
        ELSE NULL
      END
      WHERE storage_type IS NULL
        AND uploader_type IS NOT NULL
        AND COALESCE(video_storage_provider, '') != 'bunny_stream';
    `);

    // ── 3. automatic QRIS top-up columns and indexes ─────────────────────────
    // Keep this in the boot migration as well as lib/db/src/migrate.ts so an
    // imported project can start safely even when the standalone migration has
    // not been run yet.
    await runStep(client, "topups payment columns", `
      ALTER TABLE topups ADD COLUMN IF NOT EXISTS transfer_amount double precision;
      ALTER TABLE topups ADD COLUMN IF NOT EXISTS amount_match_status text DEFAULT 'match';
      ALTER TABLE topups ADD COLUMN IF NOT EXISTS order_id text;
      ALTER TABLE topups ADD COLUMN IF NOT EXISTS payment_method text DEFAULT 'qris';
      ALTER TABLE topups ADD COLUMN IF NOT EXISTS gateway text;
      ALTER TABLE topups ADD COLUMN IF NOT EXISTS gateway_reference text;
      ALTER TABLE topups ADD COLUMN IF NOT EXISTS qr_code_url text;
      ALTER TABLE topups ADD COLUMN IF NOT EXISTS qris_string text;
      ALTER TABLE topups ADD COLUMN IF NOT EXISTS payment_link text;
      ALTER TABLE topups ADD COLUMN IF NOT EXISTS expired_at timestamptz;
      ALTER TABLE topups ADD COLUMN IF NOT EXISTS paid_at timestamptz;
      ALTER TABLE topups ADD COLUMN IF NOT EXISTS provider text;
      ALTER TABLE topups ADD COLUMN IF NOT EXISTS provider_transaction_id text;
      ALTER TABLE topups ADD COLUMN IF NOT EXISTS provider_payload jsonb;
      ALTER TABLE topups ADD COLUMN IF NOT EXISTS callback_received_at timestamptz;
      ALTER TABLE topups ADD COLUMN IF NOT EXISTS description text;
    `);
    await runStep(client, "topups status/indexes", `
      DO $$ BEGIN ALTER TYPE topup_status ADD VALUE IF NOT EXISTS 'paid'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN ALTER TYPE topup_status ADD VALUE IF NOT EXISTS 'awaiting_confirmation'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN ALTER TYPE topup_status ADD VALUE IF NOT EXISTS 'expired'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN ALTER TYPE topup_status ADD VALUE IF NOT EXISTS 'failed'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN ALTER TYPE topup_status ADD VALUE IF NOT EXISTS 'cancelled'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN ALTER TYPE topup_status ADD VALUE IF NOT EXISTS 'rejected'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      CREATE UNIQUE INDEX IF NOT EXISTS topups_order_id_unique ON topups(order_id) WHERE order_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS topups_gateway_reference_unique ON topups(gateway_reference) WHERE gateway_reference IS NOT NULL;
      CREATE INDEX IF NOT EXISTS topups_user_pending_idx ON topups(user_id, created_at DESC) WHERE status = 'pending';
      CREATE INDEX IF NOT EXISTS topups_provider_tx_id_idx ON topups(provider_transaction_id) WHERE provider_transaction_id IS NOT NULL;
    `);

    // ── 4. notifications table columns ──────────────────────────────────────
    await runStep(client, "notifications columns", `
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS category       text NOT NULL DEFAULT 'system';
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS actor_id       uuid REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS actor_username text;
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS actor_avatar   text;
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS reference_type text;
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS reference_id   text;
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS action_url     text;
    `);

    // ── 4. custom_roles & user_custom_roles tables ───────────────────────────
    await runStep(client, "custom_roles table", `
      CREATE TABLE IF NOT EXISTS custom_roles (
        id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name                  text NOT NULL UNIQUE,
        emoji                 text,
        color                 text NOT NULL DEFAULT '#6366f1',
        description           text,
        is_active             boolean NOT NULL DEFAULT true,
        priority              integer NOT NULL DEFAULT 0,
        perm_dashboard        boolean NOT NULL DEFAULT false,
        perm_upload_video     boolean NOT NULL DEFAULT false,
        perm_my_video         boolean NOT NULL DEFAULT false,
        perm_leaderboard      boolean NOT NULL DEFAULT true,
        perm_creator_dashboard boolean NOT NULL DEFAULT false,
        upload_types          text NOT NULL DEFAULT 'free',
        creator_share_percent double precision NOT NULL DEFAULT 50,
        platform_share_percent double precision NOT NULL DEFAULT 50,
        created_by            uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at            timestamptz NOT NULL DEFAULT now(),
        updated_at            timestamptz NOT NULL DEFAULT now()
      );
    `);
    await runStep(client, "custom_roles indexes", `
      CREATE INDEX IF NOT EXISTS custom_roles_priority_idx  ON custom_roles(priority);
      CREATE INDEX IF NOT EXISTS custom_roles_is_active_idx ON custom_roles(is_active);
    `);
    await runStep(client, "user_custom_roles table", `
      CREATE TABLE IF NOT EXISTS user_custom_roles (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role_id     uuid NOT NULL REFERENCES custom_roles(id) ON DELETE CASCADE,
        assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
        assigned_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await runStep(client, "user_custom_roles indexes", `
      CREATE INDEX IF NOT EXISTS user_custom_roles_user_idx ON user_custom_roles(user_id);
      CREATE INDEX IF NOT EXISTS user_custom_roles_role_idx ON user_custom_roles(role_id);
    `);

    // ── 5. custom_role_id column on users ───────────────────────────────────
    // Adds the FK column that lets the Users admin page assign a primary custom
    // role to each user. ON DELETE SET NULL ensures no orphan pointers when a
    // custom role is deleted. Idempotent — ADD COLUMN IF NOT EXISTS is a no-op
    // if the column already exists.
    await runStep(client, "users.custom_role_id column", `
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS custom_role_id uuid
          REFERENCES custom_roles(id) ON DELETE SET NULL;
    `);
    await runStep(client, "users.custom_role_id index", `
      CREATE INDEX IF NOT EXISTS users_custom_role_id_idx ON users(custom_role_id);
    `);

    // ── 6. Automatic top-up fee config columns on settings ───────────────────
    await runStep(client, "settings automatic fee columns", `
      ALTER TABLE settings ADD COLUMN IF NOT EXISTS automatic_fee_type text DEFAULT 'percentage';
      ALTER TABLE settings ADD COLUMN IF NOT EXISTS automatic_fee_rate double precision DEFAULT 0;
    `);

    // ── 7. awaiting_manual_review status for manual top-ups ──────────────────
    await runStep(client, "topup_status: add 'awaiting_manual_review'", `
      DO $$ BEGIN ALTER TYPE topup_status ADD VALUE IF NOT EXISTS 'awaiting_manual_review'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    // ── 8. Gamification system tables ─────────────────────────────────────────
    await runStep(client, "gamification: achievement_rarity enum", `
      DO $$ BEGIN
        CREATE TYPE achievement_rarity AS ENUM ('COMMON', 'RARE', 'EPIC', 'LEGENDARY', 'SPECIAL');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await runStep(client, "gamification: exp_source enum", `
      DO $$ BEGIN
        CREATE TYPE exp_source AS ENUM (
          'login', 'watch_video', 'like_video', 'comment', 'send_message',
          'join_group', 'achievement', 'daily_mission', 'upload_video',
          'admin_adjustment', 'level_reward'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await runStep(client, "gamification: user_levels table", `
      CREATE TABLE IF NOT EXISTS user_levels (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        total_exp       integer NOT NULL DEFAULT 0,
        current_level   integer NOT NULL DEFAULT 1,
        exp_today       integer NOT NULL DEFAULT 0,
        exp_today_date  text,
        lifetime_exp    integer NOT NULL DEFAULT 0,
        last_exp_activity timestamp,
        streak_days     integer NOT NULL DEFAULT 0,
        last_login_date text,
        created_at      timestamp NOT NULL DEFAULT NOW(),
        updated_at      timestamp NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS user_levels_user_idx ON user_levels(user_id);
      CREATE INDEX IF NOT EXISTS user_levels_level_idx ON user_levels(current_level);
      CREATE INDEX IF NOT EXISTS user_levels_total_exp_idx ON user_levels(total_exp);
    `);
    await runStep(client, "gamification: exp_transactions table", `
      CREATE TABLE IF NOT EXISTS exp_transactions (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount      integer NOT NULL,
        source      exp_source NOT NULL,
        reference_id text,
        metadata    jsonb,
        created_at  timestamp NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS exp_transactions_user_idx ON exp_transactions(user_id);
      CREATE INDEX IF NOT EXISTS exp_transactions_created_idx ON exp_transactions(created_at);
      CREATE INDEX IF NOT EXISTS exp_transactions_source_idx ON exp_transactions(source);
      CREATE UNIQUE INDEX IF NOT EXISTS exp_transactions_ref_idx ON exp_transactions(user_id, source, reference_id);
    `);
    await runStep(client, "gamification: achievements table", `
      CREATE TABLE IF NOT EXISTS achievements (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name             text NOT NULL,
        description      text NOT NULL,
        icon             text NOT NULL DEFAULT '🏆',
        rarity           achievement_rarity NOT NULL DEFAULT 'COMMON',
        requirement_type text NOT NULL,
        requirement_value integer NOT NULL DEFAULT 1,
        exp_reward       integer NOT NULL DEFAULT 0,
        badge_reward     text,
        is_hidden        boolean NOT NULL DEFAULT false,
        is_active        boolean NOT NULL DEFAULT true,
        created_at       timestamp NOT NULL DEFAULT NOW(),
        updated_at       timestamp NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS achievements_active_idx ON achievements(is_active);
      CREATE INDEX IF NOT EXISTS achievements_req_type_idx ON achievements(requirement_type);
    `);
    await runStep(client, "gamification: user_achievements table", `
      CREATE TABLE IF NOT EXISTS user_achievements (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        achievement_id uuid NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
        unlocked_at    timestamp NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS user_achievements_unique_idx ON user_achievements(user_id, achievement_id);
      CREATE INDEX IF NOT EXISTS user_achievements_user_idx ON user_achievements(user_id);
    `);
    await runStep(client, "gamification: special_badges table", `
      CREATE TABLE IF NOT EXISTS special_badges (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name        text NOT NULL UNIQUE,
        icon        text NOT NULL DEFAULT '⭐',
        color       text NOT NULL DEFAULT '#8b5cf6',
        description text,
        is_active   boolean NOT NULL DEFAULT true,
        created_at  timestamp NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS special_badges_active_idx ON special_badges(is_active);
    `);
    await runStep(client, "gamification: user_special_badges table", `
      CREATE TABLE IF NOT EXISTS user_special_badges (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        badge_id    uuid NOT NULL REFERENCES special_badges(id) ON DELETE CASCADE,
        assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
        assigned_at timestamp NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS user_special_badges_unique_idx ON user_special_badges(user_id, badge_id);
      CREATE INDEX IF NOT EXISTS user_special_badges_user_idx ON user_special_badges(user_id);
    `);
    await runStep(client, "gamification: user_showcase_badges table", `
      CREATE TABLE IF NOT EXISTS user_showcase_badges (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        badge_type   text NOT NULL,
        badge_ref    uuid,
        display_order integer NOT NULL DEFAULT 0,
        created_at    timestamp NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS user_showcase_badges_user_idx ON user_showcase_badges(user_id);
      CREATE INDEX IF NOT EXISTS user_showcase_badges_order_idx ON user_showcase_badges(user_id, display_order);
    `);
    await runStep(client, "gamification: user_statistics table", `
      CREATE TABLE IF NOT EXISTS user_statistics (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        videos_watched   integer NOT NULL DEFAULT 0,
        videos_liked     integer NOT NULL DEFAULT 0,
        comments_posted  integer NOT NULL DEFAULT 0,
        messages_sent    integer NOT NULL DEFAULT 0,
        groups_joined    integer NOT NULL DEFAULT 0,
        videos_uploaded  integer NOT NULL DEFAULT 0,
        updated_at       timestamp NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS user_statistics_user_idx ON user_statistics(user_id);
    `);
    await runStep(client, "gamification: level_rewards table", `
      CREATE TABLE IF NOT EXISTS level_rewards (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        level       integer NOT NULL,
        reward_type text NOT NULL DEFAULT 'profile_frame',
        reward_value text,
        description text,
        created_at  timestamp NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS level_rewards_level_idx ON level_rewards(level);
    `);
    await runStep(client, "gamification: exp_audit_logs table", `
      CREATE TABLE IF NOT EXISTS exp_audit_logs (
        id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        admin_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount    integer NOT NULL,
        reason    text NOT NULL,
        created_at timestamp NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS exp_audit_logs_user_idx ON exp_audit_logs(user_id);
      CREATE INDEX IF NOT EXISTS exp_audit_logs_admin_idx ON exp_audit_logs(admin_id);
    `);
    await runStep(client, "gamification: user_privacy_settings table", `
      CREATE TABLE IF NOT EXISTS user_privacy_settings (
        id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        show_level          boolean NOT NULL DEFAULT true,
        show_badges         boolean NOT NULL DEFAULT true,
        show_achievements   boolean NOT NULL DEFAULT true,
        show_total_video    boolean NOT NULL DEFAULT true,
        show_chat_count     boolean NOT NULL DEFAULT false,
        show_activity_stats boolean NOT NULL DEFAULT false,
        updated_at          timestamp NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS user_privacy_settings_user_idx ON user_privacy_settings(user_id);
    `);
    await runStep(client, "gamification: gamification_config table", `
      CREATE TABLE IF NOT EXISTS gamification_config (
        id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        base_exp            integer NOT NULL DEFAULT 100,
        step_exp            integer NOT NULL DEFAULT 50,
        growth_multiplier   double precision NOT NULL DEFAULT 1.0,
        multiplier_interval integer NOT NULL DEFAULT 5,
        max_level           integer NOT NULL DEFAULT 0,
        updated_at          timestamp NOT NULL DEFAULT NOW()
      );
    `);
    await runStep(client, "gamification: level_badge_tiers table", `
      CREATE TABLE IF NOT EXISTS level_badge_tiers (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name        text NOT NULL,
        icon        text NOT NULL DEFAULT '🆕',
        color       text NOT NULL DEFAULT '#94a3b8',
        min_level   integer NOT NULL DEFAULT 1,
        sort_order  integer NOT NULL DEFAULT 0,
        created_at  timestamp NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS level_badge_tiers_min_level_idx ON level_badge_tiers(min_level);
    `);
  } finally {
    client.release();
  }
}

/**
 * @deprecated Use runCriticalStartupMigration() + runBestEffortStartupMigration() instead.
 * Kept for backward compatibility — runs both phases, treating the critical phase
 * as best-effort for callers that have not been updated yet.
 */
export async function runStartupMigration(): Promise<void> {
  await runCriticalStartupMigration();
  await runBestEffortStartupMigration();
}
