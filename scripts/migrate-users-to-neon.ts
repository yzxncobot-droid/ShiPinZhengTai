/**
 * scripts/migrate-users-to-neon.ts
 *
 * Idempotent migration script that:
 * 1. Back-fills referral codes for any user that doesn't have one yet
 * 2. Back-fills wallet rows for any user missing a wallet ledger entry
 * 3. Syncs subscription_status / subscription_expiry cache on users table
 * 4. Converts legacy "user" role → "meril"
 * 5. Prints a summary of all tables in the database
 *
 * Usage:
 *   pnpm --filter @workspace/db exec ts-node --esm ../../scripts/migrate-users-to-neon.ts
 * OR (after build):
 *   DATABASE_URL=... node scripts/migrate-users-to-neon.mjs
 */

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { nanoid } from "nanoid";
import * as schema from "../lib/db/src/schema/index.js";
import { eq, isNull, and, gte, sql } from "drizzle-orm";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("❌  DATABASE_URL is not set");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

async function generateUniqueCode(): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = nanoid(8).toUpperCase();
    const [existing] = await db.select({ id: schema.usersTable.id })
      .from(schema.usersTable)
      .where(eq(schema.usersTable.referralCode, code))
      .limit(1);
    if (!existing) return code;
  }
  return nanoid(12).toUpperCase();
}

async function run() {
  console.log("🚀  Neon PostgreSQL migration script starting…\n");

  // ── 1. Back-fill referral codes ─────────────────────────────────────────────
  const usersWithoutCode = await db.select({ id: schema.usersTable.id })
    .from(schema.usersTable)
    .where(isNull(schema.usersTable.referralCode));

  console.log(`📋  Users without referral code: ${usersWithoutCode.length}`);
  for (const user of usersWithoutCode) {
    const code = await generateUniqueCode();
    await db.update(schema.usersTable)
      .set({ referralCode: code, updatedAt: new Date() })
      .where(eq(schema.usersTable.id, user.id));
  }
  console.log(`✅  Referral codes back-filled for ${usersWithoutCode.length} users`);

  // ── 2. Convert legacy "user" role → "meril" ─────────────────────────────────
  const legacyUsers = await db.select({ id: schema.usersTable.id, role: schema.usersTable.role })
    .from(schema.usersTable)
    .where(eq(schema.usersTable.role, "user"));

  console.log(`\n👤  Users with legacy "user" role: ${legacyUsers.length}`);
  if (legacyUsers.length > 0) {
    await db.update(schema.usersTable)
      .set({ role: "meril", updatedAt: new Date() })
      .where(eq(schema.usersTable.role, "user"));
    console.log(`✅  Converted ${legacyUsers.length} users: "user" → "meril"`);
  } else {
    console.log("   ✓ No legacy roles to convert");
  }

  // ── 3. Back-fill wallet rows ─────────────────────────────────────────────────
  const allUsers = await db.select({
    id: schema.usersTable.id,
    walletBalance: schema.usersTable.walletBalance,
    totalTopup: schema.usersTable.totalTopup,
    totalSpent: schema.usersTable.totalSpent,
  }).from(schema.usersTable);

  let walletCreated = 0;
  for (const user of allUsers) {
    const result = await db.insert(schema.walletsTable)
      .values({
        userId: user.id,
        balance: user.walletBalance,
        totalEarned: user.totalTopup,
        totalSpent: user.totalSpent,
      })
      .onConflictDoNothing()
      .returning({ id: schema.walletsTable.id });
    if (result.length > 0) walletCreated++;
  }
  console.log(`\n💰  Wallet rows created: ${walletCreated} / ${allUsers.length} users`);

  // ── 4. Sync subscription_status / subscription_expiry cache ─────────────────
  const now = new Date();
  const activeSubs = await db
    .select({
      userId: schema.userSubscriptionsTable.userId,
      endDate: schema.userSubscriptionsTable.endDate,
    })
    .from(schema.userSubscriptionsTable)
    .where(
      and(
        eq(schema.userSubscriptionsTable.isActive, true),
        gte(schema.userSubscriptionsTable.endDate, now),
      ),
    );

  const activeMap = new Map<number, Date>();
  for (const s of activeSubs) activeMap.set(s.userId, new Date(s.endDate));

  let subSynced = 0;
  for (const user of allUsers) {
    const expiry = activeMap.get(user.id);
    const status = expiry ? "active" : "none";

    const [current] = await db.select({
      subscriptionStatus: schema.usersTable.subscriptionStatus,
      subscriptionExpiry: schema.usersTable.subscriptionExpiry,
    }).from(schema.usersTable).where(eq(schema.usersTable.id, user.id)).limit(1);

    const needsUpdate =
      current?.subscriptionStatus !== status ||
      (expiry && current?.subscriptionExpiry?.toISOString() !== expiry.toISOString());

    if (needsUpdate) {
      await db.update(schema.usersTable)
        .set({ subscriptionStatus: status as any, subscriptionExpiry: expiry ?? null, updatedAt: new Date() })
        .where(eq(schema.usersTable.id, user.id));
      subSynced++;
    }
  }
  console.log(`\n📅  Subscription status synced for ${subSynced} users`);

  // ── 5. Summary ───────────────────────────────────────────────────────────────
  console.log("\n📊  Table row counts:");
  const tables: Array<{ name: string; table: any }> = [
    { name: "users", table: schema.usersTable },
    { name: "wallets", table: schema.walletsTable },
    { name: "wallet_transactions", table: schema.walletTransactionsTable },
    { name: "subscriptions (plans)", table: schema.subscriptionsTable },
    { name: "user_subscriptions", table: schema.userSubscriptionsTable },
    { name: "topups (payments)", table: schema.topupsTable },
    { name: "payment_proofs", table: schema.paymentProofsTable },
    { name: "video_purchases", table: schema.videoPurchasesTable },
    { name: "bundle_purchases", table: schema.bundlePurchasesTable },
    { name: "transactions", table: schema.transactionsTable },
    { name: "referrals", table: schema.referralsTable },
    { name: "notifications", table: schema.notificationsTable },
    { name: "audit_logs", table: schema.auditLogsTable },
  ];

  for (const { name, table } of tables) {
    const [{ cnt }] = await db.select({ cnt: sql<number>`count(*)::int` }).from(table);
    console.log(`   ${name.padEnd(28)} ${cnt}`);
  }

  console.log("\n✅  Migration complete!");
  await pool.end();
}

run().catch((err) => {
  console.error("❌  Migration failed:", err);
  pool.end();
  process.exit(1);
});
