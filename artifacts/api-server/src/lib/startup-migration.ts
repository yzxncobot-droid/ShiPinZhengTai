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
    // 1. Add column (idempotent)
    await client.query(`
      ALTER TABLE videos ADD COLUMN IF NOT EXISTS storage_type text;
    `);

    // 2. Back-fill from uploader_type for rows that already have it
    const { rowCount } = await client.query(`
      UPDATE videos
      SET storage_type = CASE
        WHEN uploader_type IN ('creator', 'verified_creator') THEN 'PUBLIC'
        WHEN uploader_type = 'owner'                         THEN 'OWNER'
        ELSE NULL
      END
      WHERE storage_type IS NULL AND uploader_type IS NOT NULL
    `);

    if (rowCount && rowCount > 0) {
      logger.info({ rowCount }, "startup-migration: back-filled storage_type for existing videos");
    } else {
      logger.info("startup-migration: storage_type column ensured (no rows to back-fill)");
    }
  } catch (err: any) {
    // Non-fatal — log and continue. The column may already exist or the DB
    // may be temporarily unavailable. Do NOT crash the server.
    logger.warn({ err: err?.message }, "startup-migration: storage_type migration failed (non-fatal)");
  } finally {
    client.release();
  }
}
