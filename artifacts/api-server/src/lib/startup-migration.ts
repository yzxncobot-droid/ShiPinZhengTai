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

    // ── 3. notifications table columns ──────────────────────────────────────
    await runStep(client, "notifications columns", `
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS category       text NOT NULL DEFAULT 'system';
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS actor_id       uuid REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS actor_username text;
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS actor_avatar   text;
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS reference_type text;
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS reference_id   text;
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS action_url     text;
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
