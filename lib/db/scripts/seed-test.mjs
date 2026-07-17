#!/usr/bin/env node
/**
 * Idempotent seed: creates an owner account + 3 categories if none exist.
 * Uses pg directly (no external deps beyond what the workspace provides).
 */
import { createRequire } from "module";
import crypto from "crypto";

const require = createRequire(import.meta.url);
const pg = require("/home/runner/workspace/node_modules/.pnpm/pg@8.22.0/node_modules/pg");
const { Pool } = pg;

// Simple password hashing without bcryptjs: use node crypto with PBKDF2
// (for test seed only — real auth uses bcryptjs via the API)
async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, 100000, 64, "sha512", (err, key) => {
      if (err) reject(err);
      else resolve(`pbkdf2:${salt}:${key.toString("hex")}`);
    });
  });
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // ── Check if any users exist ──────────────────────────────────────────────
  const { rows: existingUsers } = await pool.query(
    `SELECT id, username, role FROM users WHERE role IN ('owner','admin') LIMIT 1`,
  );
  if (existingUsers.length === 0) {
    // Use a pre-computed bcrypt hash of "admin123" (cost 10) so the real
    // bcryptjs verify in the API works correctly.
    // Hash generated offline: bcrypt.hashSync("admin123", 10)
    const BCRYPT_ADMIN123 = "$2b$10$rMrCVFDZWkSMaG.bKBYvceaSqGP4V/Wrd8YFVF9kJkb6vI0lUV19u";
    const { rows } = await pool.query(
      `INSERT INTO users (id, username, password_hash, role, referral_code, wallet_balance, created_at, updated_at)
       VALUES ($1, 'admin', $2, 'owner', 'ADMIN001', 0, NOW(), NOW())
       ON CONFLICT (username) DO NOTHING
       RETURNING id, username, role`,
      [crypto.randomUUID(), BCRYPT_ADMIN123],
    );
    if (rows[0]) console.log("✅  Created owner user:", rows[0]);
    else console.log("ℹ️   Owner user already exists (conflict)");
  } else {
    console.log("ℹ️   Owner/admin user already exists:", existingUsers[0]);
  }

  // ── Create categories if none exist ──────────────────────────────────────
  const { rows: existingCats } = await pool.query(`SELECT id, name FROM categories LIMIT 3`);
  if (existingCats.length === 0) {
    const { rows: cats } = await pool.query(`
      INSERT INTO categories (id, name, created_at, updated_at)
      VALUES
        ($1, 'Tutorial', NOW(), NOW()),
        ($2, 'Entertainment', NOW(), NOW()),
        ($3, 'Education', NOW(), NOW())
      RETURNING id, name`,
      [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()],
    );
    console.log("✅  Created categories:", cats.map(c => c.name).join(", "));
  } else {
    console.log("ℹ️   Categories already exist:", existingCats.map(c => c.name).join(", "));
  }

  // ── Print current counts ──────────────────────────────────────────────────
  const tables = ["users", "categories", "videos"];
  for (const t of tables) {
    const { rows } = await pool.query(`SELECT COUNT(*) AS n FROM ${t}`);
    console.log(`   ${t.padEnd(12)} ${rows[0].n} rows`);
  }
}

main()
  .then(() => { console.log("Done."); pool.end(); })
  .catch((e) => { console.error("Seed failed:", e.message); pool.end(); process.exit(1); });
