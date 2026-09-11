// Pre-migration cleanup: drops indexes that drizzle-kit push --force may try
// to recreate, causing "relation already exists" errors on non-fresh databases.
//
// The API's startup migrations create some indexes with CREATE INDEX IF NOT EXISTS
// (e.g. a partial index on topups.provider_transaction_id). When drizzle-kit push
// later tries to create the same-named index from the schema, it fails because
// the name already exists. This script drops those indexes first so drizzle-kit
// can create them cleanly.
//
// Run with: node lib/db/scripts/pre-migrate.mjs
import pg from "pg";

const { Pool } = pg;

const connectionString = process.env.NEON_DATABASE_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  console.error("NEON_DATABASE_URL or DATABASE_URL must be set");
  process.exit(0); // non-fatal — let drizzle-kit push handle it
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

// Indexes that may conflict between startup migrations and drizzle schema.
// These are created by raw SQL (migrate.ts / startup-migration.ts) but are
// either not in the drizzle schema or defined differently (e.g. partial vs
// non-partial). Dropping them first lets drizzle-kit push --force recreate
// cleanly without "does not exist" or "already exists" errors.
const CONFLICTING_INDEXES = [
  "topups_provider_tx_id_idx",   // partial in startup, non-partial in drizzle
  "topups_user_pending_idx",     // not in drizzle schema
  "topups_order_id_unique",      // partial unique in startup, .unique() in drizzle
  "topups_gateway_reference_unique", // partial unique in startup, .unique() in drizzle
  "users_custom_role_id_idx",    // not in drizzle schema
];

async function main() {
  const client = await pool.connect();
  try {
    for (const idx of CONFLICTING_INDEXES) {
      await client.query(`DROP INDEX IF EXISTS ${idx}`);
      console.log(`Pre-migrate: dropped ${idx} (if existed)`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Pre-migrate failed (non-fatal):", err.message);
  process.exit(0); // non-fatal — let drizzle-kit push handle it
});
