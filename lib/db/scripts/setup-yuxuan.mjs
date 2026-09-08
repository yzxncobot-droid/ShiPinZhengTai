// One-off: create owner user "Yuxuan" (password "aldo99"), assign owner badge,
// create a custom role with full video access, and assign it to the user.
// Idempotent — safe to run multiple times.
import pg from "pg";

const { Pool } = pg;

const connectionString = process.env.NEON_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  console.error("NEON_DATABASE_URL or DATABASE_URL must be set");
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

// bcrypt hash of "aldo99" (cost 12)
const PASSWORD_HASH =
  "$2b$12$f9Tc6D6kszL.cpmrIKqy2OoWKf3V4tRpGfMj8cCz4pOdAZAAkXTMi";

async function main() {
  const client = await pool.connect();
  try {
    // ── 1. Create / update user "Yuxuan" as owner ────────────────────────
    const userRes = await client.query(
      `INSERT INTO users (username, password_hash, role, wallet_balance)
       VALUES ('Yuxuan', $1, 'owner', 0)
       ON CONFLICT (username) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         role = 'owner'
       RETURNING id`,
      [PASSWORD_HASH],
    );
    const userId = userRes.rows[0].id;
    console.log(`User "Yuxuan" ready (id: ${userId}, role: owner)`);

    // ── 2. Assign "owner" badge (idempotent) ──────────────────────────────
    await client.query(
      `INSERT INTO user_badges (user_id, badge)
       VALUES ($1, 'owner')
       ON CONFLICT DO NOTHING`,
      [userId],
    );
    console.log('Owner badge assigned to Yuxuan');

    // ── 3. Create custom role "Full Video Access" ────────────────────────
    const roleRes = await client.query(
      `INSERT INTO custom_roles (name, emoji, color, description, is_active, priority,
                                  perm_dashboard, perm_upload_video, perm_my_video,
                                  perm_leaderboard, perm_creator_dashboard, perm_video_full_access,
                                  upload_types, creator_share_percent, platform_share_percent)
       VALUES ('Full Video Access', '🎬', '#e11d48', 'Dapat mengakses seluruh video tanpa membeli',
               true, 10,
               true, false, true,
               true, false, true,
               'free,premium,bundle', 50, 50)
       ON CONFLICT (name) DO UPDATE SET
         perm_video_full_access = true,
         is_active = true,
         description = EXCLUDED.description
       RETURNING id`,
    );
    const roleId = roleRes.rows[0].id;
    console.log(`Custom role "Full Video Access" ready (id: ${roleId})`);

    // ── 4. Assign custom role to Yuxuan (idempotent) ──────────────────────
    await client.query(
      `INSERT INTO user_custom_roles (user_id, role_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [userId, roleId],
    );
    console.log('Custom role assigned to Yuxuan');

    // ── 5. Link custom role to user's customRoleId field ──────────────────
    await client.query(
      `UPDATE users SET custom_role_id = $1 WHERE id = $2`,
      [roleId, userId],
    );
    console.log('User custom_role_id linked');

    console.log('\nSetup complete:');
    console.log('  Username: Yuxuan');
    console.log('  Password: aldo99');
    console.log('  Role:     owner (full access)');
    console.log('  Badge:    owner');
    console.log('  Custom:   Full Video Access (all videos without purchase)');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
