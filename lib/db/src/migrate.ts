/**
 * lib/db/src/migrate.ts
 *
 * Idempotent post-import migration:
 *  1. Back-fill referral codes for users who don't have one
 *  2. Convert legacy "user" role → "meril"
 *  3. Create missing wallet ledger rows
 *  4. Sync subscription_status / subscription_expiry cache
 *  5. Print table row counts
 *
 * Run: pnpm --filter @workspace/db exec tsx src/migrate.ts
 */

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.js";
import { eq, isNull, and, gte, sql } from "drizzle-orm";

const { Pool } = pg;

const URL = process.env.DATABASE_URL;
if (!URL) { console.error("DATABASE_URL not set"); process.exit(1); }

const pool = new Pool({ connectionString: URL });
const db = drizzle(pool, { schema });

async function genCode(): Promise<string> {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 20; attempt++) {
    let code = "";
    for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
    const [ex] = await db.select({ id: schema.usersTable.id })
      .from(schema.usersTable).where(eq(schema.usersTable.referralCode, code)).limit(1);
    if (!ex) return code;
  }
  return "R" + Date.now().toString(36).toUpperCase().slice(-7);
}

async function run() {
  console.log("🚀  Neon migration starting…\n");

  // 0. Schema additions – idempotent column additions
  await pool.query(`
    ALTER TABLE videos ADD COLUMN IF NOT EXISTS video_source_type text NOT NULL DEFAULT 'upload';
    ALTER TABLE videos ADD COLUMN IF NOT EXISTS video_file_path text;
    ALTER TABLE topups ADD COLUMN IF NOT EXISTS transfer_amount double precision;
    ALTER TABLE topups ADD COLUMN IF NOT EXISTS amount_match_status text DEFAULT 'match';
    ALTER TABLE topups ADD COLUMN IF NOT EXISTS order_id text;
    ALTER TABLE topups ADD COLUMN IF NOT EXISTS payment_method text DEFAULT 'qris';
    ALTER TABLE topups ADD COLUMN IF NOT EXISTS gateway text;
    ALTER TABLE topups ADD COLUMN IF NOT EXISTS gateway_reference text;
    ALTER TABLE topups ADD COLUMN IF NOT EXISTS qr_code_url text;
    ALTER TABLE topups ADD COLUMN IF NOT EXISTS qris_string text;
    ALTER TABLE topups ADD COLUMN IF NOT EXISTS expired_at timestamptz;
    ALTER TABLE topups ADD COLUMN IF NOT EXISTS paid_at timestamptz;
    ALTER TABLE videos ADD COLUMN IF NOT EXISTS uploader_type text;
    ALTER TABLE videos ADD COLUMN IF NOT EXISTS thumbnail_path text;
    ALTER TABLE videos ADD COLUMN IF NOT EXISTS storage_folder text;
    ALTER TABLE videos ADD COLUMN IF NOT EXISTS bucket_name text;
    ALTER TABLE videos ADD COLUMN IF NOT EXISTS storage_type text;
  `);
  await pool.query(`
    DO $$ BEGIN ALTER TYPE topup_status ADD VALUE IF NOT EXISTS 'paid'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN ALTER TYPE topup_status ADD VALUE IF NOT EXISTS 'expired'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN ALTER TYPE topup_status ADD VALUE IF NOT EXISTS 'failed'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN ALTER TYPE topup_status ADD VALUE IF NOT EXISTS 'cancelled'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    CREATE UNIQUE INDEX IF NOT EXISTS topups_order_id_unique ON topups(order_id) WHERE order_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS topups_gateway_reference_unique ON topups(gateway_reference) WHERE gateway_reference IS NOT NULL;
    CREATE INDEX IF NOT EXISTS topups_user_pending_idx ON topups(user_id, created_at DESC) WHERE status = 'pending';
  `);
  console.log("✅  topup automatic QRIS columns and status values ensured");

  // Back-fill storage_type from existing uploader_type data.
  // Bunny Stream rows are intentionally excluded: their video_url is a Bunny
  // CDN/embed URL, not an OWNER Supabase URL, so marking them OWNER would
  // be inaccurate. They remain NULL until a dedicated real-location migration.
  await pool.query(`
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
  console.log("✅  storage_type back-filled from uploader_type for existing rows");

  // 1. Back-fill referral codes
  const noCode = await db.select({ id: schema.usersTable.id })
    .from(schema.usersTable).where(isNull(schema.usersTable.referralCode));
  console.log(`📋  Users without referral code: ${noCode.length}`);
  for (const u of noCode) {
    const code = await genCode();
    await db.update(schema.usersTable)
      .set({ referralCode: code, updatedAt: new Date() })
      .where(eq(schema.usersTable.id, u.id));
  }
  console.log(`✅  Back-filled ${noCode.length} referral codes`);

  // 2. Convert "user" → "meril"
  const legacy = await db.select({ id: schema.usersTable.id })
    .from(schema.usersTable).where(eq(schema.usersTable.role, "user"));
  if (legacy.length > 0) {
    await db.update(schema.usersTable)
      .set({ role: "meril" as any, updatedAt: new Date() })
      .where(eq(schema.usersTable.role, "user"));
  }
  console.log(`\n👤  Converted "user"→"meril": ${legacy.length} rows`);

  // 3. Back-fill wallet rows
  const allUsers = await db.select({
    id: schema.usersTable.id,
    walletBalance: schema.usersTable.walletBalance,
    totalTopup: schema.usersTable.totalTopup,
    totalSpent: schema.usersTable.totalSpent,
  }).from(schema.usersTable);

  let walletCreated = 0;
  for (const u of allUsers) {
    const rows = await db.insert(schema.walletsTable)
      .values({ userId: u.id, balance: u.walletBalance, totalEarned: u.totalTopup, totalSpent: u.totalSpent })
      .onConflictDoNothing()
      .returning({ id: schema.walletsTable.id });
    if (rows.length > 0) walletCreated++;
  }
  console.log(`\n💰  Wallet rows created: ${walletCreated} / ${allUsers.length}`);

  // 4. Sync subscription cache
  const now = new Date();
  const activeSubs = await db
    .select({ userId: schema.userSubscriptionsTable.userId, endDate: schema.userSubscriptionsTable.endDate })
    .from(schema.userSubscriptionsTable)
    .where(and(eq(schema.userSubscriptionsTable.isActive, true), gte(schema.userSubscriptionsTable.endDate, now)));

  const activeMap = new Map<string, Date>(activeSubs.map(s => [s.userId, new Date(s.endDate)]));
  let subSynced = 0;
  for (const u of allUsers) {
    const expiry = activeMap.get(u.id) ?? null;
    const status = expiry ? "active" : "none";
    await db.update(schema.usersTable)
      .set({ subscriptionStatus: status as any, subscriptionExpiry: expiry, updatedAt: new Date() })
      .where(and(eq(schema.usersTable.id, u.id)));
    subSynced++;
  }
  console.log(`\n📅  Subscription status synced: ${subSynced} users`);

  // 5. Summary
  console.log("\n📊  Row counts:");
  const counts: Array<[string, any]> = [
    ["users", schema.usersTable],
    ["wallets", schema.walletsTable],
    ["wallet_transactions", schema.walletTransactionsTable],
    ["subscription_plans", schema.subscriptionsTable],
    ["user_subscriptions", schema.userSubscriptionsTable],
    ["topups/payments", schema.topupsTable],
    ["payment_proofs", schema.paymentProofsTable],
    ["video_purchases", schema.videoPurchasesTable],
    ["bundle_purchases", schema.bundlePurchasesTable],
    ["transactions", schema.transactionsTable],
    ["referrals", schema.referralsTable],
    ["notifications", schema.notificationsTable],
    ["audit_logs", schema.auditLogsTable],
  ];
  for (const [name, table] of counts) {
    const [{ c }] = await db.select({ c: sql<number>`count(*)::int` }).from(table);
    console.log(`   ${name.padEnd(26)} ${c}`);
  }

  console.log("\n✅  Migration complete!");
  await pool.end();
}

run().catch(err => { console.error("❌ Failed:", err.message); pool.end(); process.exit(1); });
