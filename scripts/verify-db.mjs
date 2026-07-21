#!/usr/bin/env node
/**
 * verify-db.mjs
 * Sanity check: connects to the configured database and prints row counts
 * for core tables, confirming the external database is reachable and intact.
 *
 * Run from the repo root with:
 *   pnpm --filter @workspace/db exec node ../../scripts/verify-db.mjs
 *
 * Uses NEON_DATABASE_URL (preferred) or DATABASE_URL as fallback.
 * Expected output (as of setup on 2026-07-21):
 *   users 202 | videos 42 | categories 17 | settings 1 | bundles 4
 */

import pg from "pg";

const connectionString =
  process.env.NEON_DATABASE_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  console.error(
    "❌  No database URL found. Set NEON_DATABASE_URL or DATABASE_URL."
  );
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  max: 1,
  connectionTimeoutMillis: 5000,
});

const TABLES = [
  "users",
  "videos",
  "categories",
  "settings",
  "bundles",
  "wallets",
  "wallet_transactions",
  "subscriptions",
  "chat_rooms",
];

async function main() {
  console.log("🔌  Connecting to database…");
  const client = await pool.connect();
  try {
    console.log("✅  Connected.\n");
    console.log("Table              Rows");
    console.log("─────────────────────────");
    for (const table of TABLES) {
      try {
        const { rows } = await client.query(
          `SELECT count(*)::int AS n FROM "${table}"`
        );
        console.log(`${table.padEnd(18)} ${rows[0].n}`);
      } catch {
        console.log(`${table.padEnd(18)} (not found)`);
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("❌  Error:", err.message);
  process.exit(1);
});
