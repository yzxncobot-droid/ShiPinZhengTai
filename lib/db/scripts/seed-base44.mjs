// Base44 seed: creates an admin/owner account + demo content on the active DB.
// Prefers NEON_DATABASE_URL (Neon) over DATABASE_URL (local), with SSL for Neon.
// Idempotent — safe to run multiple times.
//
// Run with: node lib/db/scripts/seed-base44.mjs
import pg from "pg";

const { Pool } = pg;

const connectionString = process.env.NEON_DATABASE_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  console.error("NEON_DATABASE_URL or DATABASE_URL must be set");
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }, // required for Neon; harmless for local SSL
});

async function main() {
  const client = await pool.connect();
  try {
    // ── Admin / owner account (idempotent) ───────────────────────────────
    // Pre-computed bcrypt hash of "admin123" (cost 10) — works with the API's
    // bcrypt.verify on login.
    const BCRYPT_ADMIN123 =
      "$2b$12$bfqzArvSOPWeDTUHuRySF.kNyhOLbirsPgnYm/laqTc/4HaJHYLpW";
    await client.query(
      `INSERT INTO users (username, password_hash, role, referral_code, wallet_balance)
       VALUES ('admin', $1, 'owner', 'ADMIN001', 0)
       ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [BCRYPT_ADMIN123],
    );
    console.log("Admin account ready (username: admin, password: admin123)");

    // ── Demo creator (idempotent) ────────────────────────────────────────
    const existingUser = await client.query(
      `SELECT id FROM users WHERE username = 'kids_creator'`,
    );
    let creatorId;
    if (existingUser.rows.length) {
      creatorId = existingUser.rows[0].id;
    } else {
      const passwordHash =
        "$2b$10$seedaccountplaceholderhashnotusedforlogin.......";
      const res = await client.query(
        `INSERT INTO users (username, email, password_hash, role, wallet_balance)
         VALUES ('kids_creator', 'creator@funplus.demo', $1, 'user', 125000) RETURNING id`,
        [passwordHash],
      );
      creatorId = res.rows[0].id;
    }

    // ── Categories (idempotent by unique name) ───────────────────────────
    const categories = [
      { name: "Belajar", icon: "📚" },
      { name: "Seru", icon: "😄" },
      { name: "Isi Waktu", icon: "⏰" },
      { name: "Indonesia", icon: "🇮🇩" },
    ];
    const categoryIds = {};
    for (const c of categories) {
      const existing = await client.query(
        `SELECT id FROM categories WHERE name = $1`,
        [c.name],
      );
      if (existing.rows.length) {
        categoryIds[c.name] = existing.rows[0].id;
      } else {
        const res = await client.query(
          `INSERT INTO categories (name, icon) VALUES ($1, $2) RETURNING id`,
          [c.name, c.icon],
        );
        categoryIds[c.name] = res.rows[0].id;
      }
    }

    // ── Videos (only seed if table is empty) ─────────────────────────────
    const countRes = await client.query(
      `SELECT COUNT(*)::int AS count FROM videos`,
    );
    if (countRes.rows[0].count > 0) {
      console.log(
        `Videos table already has ${countRes.rows[0].count} rows — skipping video seed.`,
      );
    } else {
      const videos = [
        {
          title: "Petualangan Bocil Belajar",
          description:
            "Paket video belajar seru untuk anak-anak hebat! Ayo belajar huruf dan angka sambil bermain.",
          thumbnail: "https://picsum.photos/seed/funplus-belajar/800/450",
          videoUrl:
            "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
          type: "premium",
          price: 7000,
          category: "Belajar",
          featured: true,
          views: 1142,
          likes: 210,
        },
        {
          title: "Bocil dan Teman Teman",
          description:
            "Belajar berbagi dan bekerja sama itu menyenangkan! Ikuti keseruan bermain bersama teman.",
          thumbnail: "https://picsum.photos/seed/funplus-teman/800/450",
          videoUrl:
            "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
          type: "free",
          price: null,
          category: "Seru",
          featured: false,
          views: 856,
          likes: 132,
        },
        {
          title: "Bocil Mandiri",
          description:
            "Serunya belajar mandiri setiap hari! Sikat gigi, rapikan mainan, dan jadi anak hebat.",
          thumbnail: "https://picsum.photos/seed/funplus-mandiri/800/450",
          videoUrl:
            "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
          type: "premium",
          price: 3000,
          category: "Isi Waktu",
          featured: false,
          views: 640,
          likes: 98,
        },
        {
          title: "Petualangan Bocil Berani",
          description:
            "Yuk jadi anak berani dan percaya diri! Petualangan seru menanti di setiap episode.",
          thumbnail: "https://picsum.photos/seed/funplus-berani/800/450",
          videoUrl:
            "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
          type: "premium",
          price: 6000,
          category: "Indonesia",
          featured: false,
          views: 1023,
          likes: 187,
        },
        {
          title: "Dongeng Sebelum Tidur",
          description:
            "Cerita seru sebelum tidur yang bikin mimpi indah. Cocok untuk menemani malam si kecil.",
          thumbnail: "https://picsum.photos/seed/funplus-dongeng/800/450",
          videoUrl:
            "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
          type: "free",
          price: null,
          category: "Seru",
          featured: false,
          views: 2044,
          likes: 301,
        },
        {
          title: "Lagu Anak Ceria",
          description:
            "Kumpulan lagu anak paling ceria untuk menemani hari-harimu penuh semangat.",
          thumbnail: "https://picsum.photos/seed/funplus-lagu/800/450",
          videoUrl:
            "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
          type: "free",
          price: null,
          category: "Belajar",
          featured: false,
          views: 3120,
          likes: 512,
        },
      ];

      for (const v of videos) {
        await client.query(
          `INSERT INTO videos (title, description, thumbnail, video_url, type, price, views, likes, is_featured, category_id, creator_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            v.title,
            v.description,
            v.thumbnail,
            v.videoUrl,
            v.type,
            v.price,
            v.views,
            v.likes,
            v.featured,
            categoryIds[v.category],
            creatorId,
          ],
        );
      }
      console.log(`Seeded ${videos.length} videos across ${categories.length} categories.`);
    }

    // ── Subscription plans (only seed if table is empty) ─────────────────
    const planCountRes = await client.query(
      `SELECT COUNT(*)::int AS count FROM subscriptions`,
    );
    if (planCountRes.rows[0].count > 0) {
      console.log(
        `Subscriptions table already has ${planCountRes.rows[0].count} rows — skipping plan seed.`,
      );
    } else {
      const plans = [
        { name: "1 Bulan", description: "Akses premium selama 1 bulan", price: 25000, durationDays: 30 },
        { name: "3 Bulan", description: "Hemat lebih banyak untuk 3 bulan penuh", price: 65000, durationDays: 90 },
        { name: "6 Bulan", description: "Paket favorit — hemat maksimal", price: 120000, durationDays: 180 },
        { name: "12 Bulan", description: "Akses premium sepanjang tahun", price: 220000, durationDays: 365 },
      ];
      for (const p of plans) {
        await client.query(
          `INSERT INTO subscriptions (name, description, price, duration_days) VALUES ($1, $2, $3, $4)`,
          [p.name, p.description, p.price, p.durationDays],
        );
      }
      console.log(`Seeded ${plans.length} subscription plans.`);
    }

    // ── Home feed videos (TikTok-style feed, separate from Shop) ─────────
    // Only seed if the table is empty.
    const feedCountRes = await client.query(
      `SELECT COUNT(*)::int AS count FROM home_feed_videos`,
    );
    if (feedCountRes.rows[0].count > 0) {
      console.log(
        `home_feed_videos already has ${feedCountRes.rows[0].count} rows — skipping feed seed.`,
      );
    } else {
      const feedVideos = [
        {
          title: "Belajar Huruf A sampai Z",
          description: "Yuk bareng belajar alfabet dengan cara yang seru dan menyenangkan!",
          videoUrl:
            "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
          thumbnail: "https://picsum.photos/seed/feed-huruf/450/800",
          sortOrder: 0,
          rewardType: "LIKE",
          rewardTarget: 100,
        },
        {
          title: "Hitung 1 sampai 10",
          description: "Belajar berhitung sambil bernyanyi! Asyik banget!",
          videoUrl:
            "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
          thumbnail: "https://picsum.photos/seed/feed-hitung/450/800",
          sortOrder: 1,
          rewardType: "LIKE",
          rewardTarget: 50,
        },
        {
          title: "Mewarnai Pelangi",
          description: "Kenali warna pelangi dan coba mewarnai sendiri di rumah!",
          videoUrl:
            "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
          thumbnail: "https://picsum.photos/seed/feed-pelangi/450/800",
          sortOrder: 2,
          rewardType: "NONE",
          rewardTarget: 0,
        },
      ];
      for (const v of feedVideos) {
        await client.query(
          `INSERT INTO home_feed_videos (title, description, video_url, thumbnail, status, is_active, sort_order, reward_type, reward_target)
           VALUES ($1, $2, $3, $4, 'published', true, $5, $6, $7)`,
          [
            v.title,
            v.description,
            v.videoUrl,
            v.thumbnail,
            v.sortOrder,
            v.rewardType,
            v.rewardTarget,
          ],
        );
      }
      console.log(`Seeded ${feedVideos.length} home feed videos.`);
    }

    console.log("Seed complete.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
