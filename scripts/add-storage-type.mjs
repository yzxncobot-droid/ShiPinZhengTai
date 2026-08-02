/**
 * Safe, idempotent migration: add storage_type column to videos table
 * and back-fill from existing uploader_type data.
 *
 * Run: node scripts/add-storage-type.mjs
 */

import pg from "pg";

const { Pool } = pg;

const connString = process.env.NEON_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connString) {
  console.error("❌  NEON_DATABASE_URL (or DATABASE_URL) is not set.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: connString,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  const client = await pool.connect();
  try {
    console.log("🚀  Storage-type migration starting…\n");

    // 1. Check current video count
    const { rows: countRows } = await client.query("SELECT COUNT(*) AS c FROM videos");
    const totalVideos = parseInt(countRows[0].c, 10);
    console.log(`📊  Total videos before migration: ${totalVideos}`);

    // 2. Add storage_type column (idempotent)
    await client.query(`
      ALTER TABLE videos ADD COLUMN IF NOT EXISTS storage_type text;
    `);
    console.log("✅  storage_type column ensured (ADD COLUMN IF NOT EXISTS)");

    // 3. Back-fill storage_type from uploader_type for existing rows that have
    //    uploader_type set but no storage_type yet.
    const { rowCount: backfilled } = await client.query(`
      UPDATE videos
      SET storage_type = CASE
        WHEN uploader_type IN ('creator', 'verified_creator') THEN 'PUBLIC'
        WHEN uploader_type = 'owner'                         THEN 'OWNER'
        ELSE NULL
      END
      WHERE storage_type IS NULL AND uploader_type IS NOT NULL
    `);
    console.log(`✅  Back-filled storage_type for ${backfilled} existing rows`);

    // 4. Verify final count matches original
    const { rows: finalRows } = await client.query("SELECT COUNT(*) AS c FROM videos");
    const finalCount = parseInt(finalRows[0].c, 10);
    console.log(`\n📊  Total videos after migration: ${finalCount}`);

    if (finalCount !== totalVideos) {
      console.error(`\n❌  COUNT MISMATCH — before: ${totalVideos}, after: ${finalCount}. Check migration_error_log.`);
      process.exit(1);
    }

    // 5. Distribution summary
    const { rows: distRows } = await client.query(`
      SELECT
        COALESCE(storage_type, '(null/legacy)') AS storage_type,
        COUNT(*) AS count
      FROM videos
      GROUP BY storage_type
      ORDER BY count DESC
    `);
    console.log("\n📋  storage_type distribution:");
    for (const r of distRows) {
      console.log(`   ${r.storage_type.padEnd(18)} ${r.count}`);
    }

    console.log("\n✅  Migration complete — all data safe.");
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error("❌  Migration failed:", err.message);
  process.exit(1);
});
