/**
 * Idempotent startup migration — runs once when the API server boots.
 *
 * Adds the `storage_type` column to the videos table if it does not
 * already exist, then back-fills it from uploader_type for existing rows.
 *
 * Safe to run on every restart: all statements use IF NOT EXISTS / WHERE IS NULL.
 */

import { pool } from "@workspace/db";
import { logger } from "./logger";

export async function runStartupMigration(): Promise<void> {
  const client = await pool.connect();
  try {
    // 1. Ensure all prerequisite columns exist (idempotent — safe to run repeatedly)
    await client.query(`
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
    logger.info("startup-migration: all video columns ensured");

    // 2. Back-fill storage_type from uploader_type for existing rows —
    //    ONLY for rows backed by Supabase (not Bunny Stream), because
    //    bunny_stream rows are on Bunny CDN, not the OWNER Supabase project.
    //    Their storage_type is intentionally left NULL until a real-location
    //    migration is performed separately.
    const { rowCount } = await client.query(`
      UPDATE videos
      SET storage_type = CASE
        WHEN uploader_type IN ('creator', 'verified_creator') THEN 'PUBLIC'
        WHEN uploader_type = 'owner'                         THEN 'OWNER'
        ELSE NULL
      END
      WHERE storage_type IS NULL
        AND uploader_type IS NOT NULL
        AND COALESCE(video_storage_provider, '') != 'bunny_stream'
    `);

    if (rowCount && rowCount > 0) {
      logger.info({ rowCount }, "startup-migration: back-filled storage_type for existing videos");
    } else {
      logger.info("startup-migration: storage_type back-fill complete (0 rows needed updating)");
    }
  } catch (err: any) {
    // Non-fatal — log and continue. The column may already exist or the DB
    // may be temporarily unavailable. Do NOT crash the server.
    logger.warn({ err: err?.message }, "startup-migration: storage_type migration failed (non-fatal)");
  } finally {
    client.release();
  }
}
