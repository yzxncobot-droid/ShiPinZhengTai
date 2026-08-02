/**
 * Idempotent startup migration — runs once when the API server boots.
 *
 * Each migration step runs in its own try/catch so a failure in one section
 * does not block subsequent sections. All statements use IF NOT EXISTS / WHERE IS NULL.
 */

import { pool } from "@workspace/db";
import { logger } from "./logger";

async function runStep(client: any, name: string, sql: string): Promise<void> {
  try {
    await client.query(sql);
    logger.info(`startup-migration: ${name} — OK`);
  } catch (err: any) {
    logger.warn({ err: err?.message }, `startup-migration: ${name} — failed (non-fatal)`);
  }
}

export async function runStartupMigration(): Promise<void> {
  const client = await pool.connect();
  try {
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
    //
    // The `category` column (and related social/payment columns) were added to
    // the Drizzle schema but never migrated to the live DB.  Because the column
    // is defined as notNull() in the schema, Drizzle always names it explicitly
    // in every INSERT, causing every notification write to fail with:
    //   "column category of relation notifications does not exist"
    //
    // We run this as a separate step so a missing `videos` table (e.g. in a
    // fresh Replit DB) does not block this critical fix.
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
