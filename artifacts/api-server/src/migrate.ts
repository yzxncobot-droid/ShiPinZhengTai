/**
 * Standalone migration script — run during the Netlify build (after
 * `drizzle-kit push --force`) to apply startup migrations and seed data
 * that aren't part of the drizzle schema.
 *
 * Usage:  node artifacts/api-server/dist/migrate.mjs
 */
import { pool } from "@workspace/db";
import { logger } from "./lib/logger";
import {
  runCriticalStartupMigration,
  runBestEffortStartupMigration,
} from "./lib/startup-migration";

async function main(): Promise<void> {
  logger.info("[MIGRATE] Starting database migrations...");

  logger.info("[MIGRATE] Phase 1: critical financial schema");
  await runCriticalStartupMigration();
  logger.info("[MIGRATE] Phase 1 complete");

  logger.info("[MIGRATE] Phase 2: best-effort schema tweaks");
  await runBestEffortStartupMigration();
  logger.info("[MIGRATE] Phase 2 complete");

  // Seed gamification defaults (best-effort)
  try {
    const { seedDefaultGamification } = await import("./lib/gamification");
    await seedDefaultGamification();
    logger.info("[MIGRATE] Gamification seed complete");
  } catch (e) {
    logger.warn(
      { err: e instanceof Error ? e.message : String(e) },
      "[MIGRATE] Gamification seed failed (non-fatal)",
    );
  }

  await pool.end();
  logger.info("[MIGRATE] All migrations complete");
  process.exit(0);
}

main().catch((err) => {
  logger.error(
    { err: err instanceof Error ? err.message : String(err) },
    "[MIGRATE] FAILED",
  );
  process.exit(1);
});
