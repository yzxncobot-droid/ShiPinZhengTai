import { Router } from "express";
import { db } from "@workspace/db";
import {
  homeFeedVideosTable,
  homeFeedLikesTable,
  homeFeedCommentsTable,
  usersTable,
} from "@workspace/db";
import { eq, and, desc, asc, sql, count, isNull } from "drizzle-orm";
import { authenticate, optionalAuth, requireRole } from "../middlewares/auth";
import { logger } from "../lib/logger";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Compute the reward progress for a home feed video.
 *
 * Progress is per-VIDEO (never per-user): every user sees the same percentage
 * for the same video. It is derived from the TOTAL number of likes or comments
 * on that video compared to the admin-set `rewardTarget`.
 *
 * Returns:
 *  - total:   current count of the relevant metric
 *  - target:  the admin-set goal
 *  - progress: min(total / target * 100, 100), 0 when target is 0/NONE
 *  - isUnlocked: total >= target && target > 0 && rewardType !== NONE
 *  - rewardType: the metric used
 */
async function computeReward(video: { rewardType: string; rewardTarget: number; id: string }) {
  const rewardType = video.rewardType ?? "NONE";
  const target = video.rewardTarget ?? 0;

  let total = 0;
  if (rewardType === "LIKE") {
    const [row] = await db
      .select({ c: count() })
      .from(homeFeedLikesTable)
      .where(eq(homeFeedLikesTable.videoId, video.id));
    total = Number(row?.c ?? 0);
  } else if (rewardType === "COMMENT") {
    const [row] = await db
      .select({ c: count() })
      .from(homeFeedCommentsTable)
      .where(eq(homeFeedCommentsTable.videoId, video.id));
    total = Number(row?.c ?? 0);
  }

  const progress = target > 0 ? Math.min(Math.round((total / target) * 100), 100) : 0;
  const isUnlocked = target > 0 && rewardType !== "NONE" && total >= target;

  return { total, target, progress, isUnlocked, rewardType };
}

/**
 * Format a home feed video for the PUBLIC feed.
 *
 * SECURITY: `rewardCode` is NEVER included here. It is only returned by the
 * dedicated `POST /home-feed/:id/reward` endpoint after the backend validates
 * the target has been reached.
 */
async function formatPublicVideo(v: any, userId?: string) {
  const [likeRow] = await db
    .select({ c: count() })
    .from(homeFeedLikesTable)
    .where(eq(homeFeedLikesTable.videoId, v.id));
  const likeCount = Number(likeRow?.c ?? 0);

  const [commentRow] = await db
    .select({ c: count() })
    .from(homeFeedCommentsTable)
    .where(eq(homeFeedCommentsTable.videoId, v.id));
  const commentCount = Number(commentRow?.c ?? 0);

  let isLiked = false;
  if (userId) {
    const [like] = await db
      .select({ id: homeFeedLikesTable.id })
      .from(homeFeedLikesTable)
      .where(and(eq(homeFeedLikesTable.videoId, v.id), eq(homeFeedLikesTable.userId, userId)))
      .limit(1);
    isLiked = !!like;
  }

  const reward = await computeReward(v);

  return {
    id: v.id,
    title: v.title,
    description: v.description,
    videoUrl: v.videoUrl,
    thumbnail: v.thumbnail,
    status: v.status,
    isActive: v.isActive,
    sortOrder: v.sortOrder,
    likeCount,
    commentCount,
    isLiked,
    reward: {
      rewardType: reward.rewardType,
      target: reward.target,
      total: reward.total,
      progress: reward.progress,
      isUnlocked: reward.isUnlocked,
      // rewardCode intentionally omitted — only sent on claim after validation
    },
    createdAt: v.createdAt,
  };
}

// ── GET /home-feed — public feed (active videos only) ────────────────────────
router.get("/home-feed", optionalAuth, async (_req, res) => {
  try {
    const userId = _req.user?.userId;
    const rows = await db
      .select()
      .from(homeFeedVideosTable)
      .where(and(eq(homeFeedVideosTable.isActive, true), eq(homeFeedVideosTable.status, "published")))
      .orderBy(asc(homeFeedVideosTable.sortOrder), desc(homeFeedVideosTable.createdAt));

    const data = await Promise.all(rows.map((v) => formatPublicVideo(v, userId)));
    res.json(data);
  } catch (err) {
    logger.error({ err }, "GET /home-feed failed");
    res.json([]);
  }
});

// ── POST /home-feed/:id/like — toggle like ───────────────────────────────────
router.post("/home-feed/:id/like", authenticate, async (req, res) => {
  const id = req.params.id as string;
  const userId = req.user!.userId;

  try {
    const [video] = await db
      .select({ id: homeFeedVideosTable.id })
      .from(homeFeedVideosTable)
      .where(eq(homeFeedVideosTable.id, id))
      .limit(1);
    if (!video) { res.status(404).json({ error: "Video tidak ditemukan" }); return; }

    // Insert; on unique violation → unlike (toggle behaviour, same as Shop).
    try {
      await db.insert(homeFeedLikesTable).values({ videoId: id, userId });
      // ── Gamification: award like EXP (idempotent per video, daily-limited) ──
      import("../lib/gamification").then(({ awardExp }) =>
        awardExp(userId, "like_video", `hf_like_${id}`, undefined, { videoId: id }).catch(() => {}),
      );
      res.json({ liked: true });
    } catch (err: any) {
      const pgCode = err?.code ?? err?.cause?.code;
      if (pgCode === "23505") {
        await db
          .delete(homeFeedLikesTable)
          .where(and(eq(homeFeedLikesTable.videoId, id), eq(homeFeedLikesTable.userId, userId)));
        res.json({ liked: false });
      } else {
        throw err;
      }
    }
  } catch (err) {
    logger.error({ err, videoId: id }, "Home feed like failed");
    res.status(500).json({ error: "Like failed" });
  }
});

// ── GET /home-feed/:id/comments ──────────────────────────────────────────────
router.get("/home-feed/:id/comments", async (req, res) => {
  const id = req.params.id as string;
  try {
    const rows = await db
      .select()
      .from(homeFeedCommentsTable)
      .where(eq(homeFeedCommentsTable.videoId, id))
      .orderBy(desc(homeFeedCommentsTable.createdAt))
      .limit(100);

    const data = await Promise.all(rows.map(async (c) => {
      const [user] = await db
        .select({ id: usersTable.id, username: usersTable.username, avatar: usersTable.avatar })
        .from(usersTable)
        .where(eq(usersTable.id, c.userId))
        .limit(1);
      return { id: c.id, videoId: c.videoId, userId: c.userId, content: c.content, createdAt: c.createdAt, user };
    }));

    res.json(data);
  } catch (err) {
    logger.error({ err, videoId: id }, "GET home-feed comments failed");
    res.json([]);
  }
});

// ── POST /home-feed/:id/comments ──────────────────────────────────────────────
router.post("/home-feed/:id/comments", authenticate, async (req, res) => {
  const id = req.params.id as string;
  const userId = req.user!.userId;
  const { content } = req.body;
  if (!content?.trim()) { res.status(400).json({ error: "Komentar tidak boleh kosong" }); return; }

  try {
    const [video] = await db
      .select({ id: homeFeedVideosTable.id })
      .from(homeFeedVideosTable)
      .where(eq(homeFeedVideosTable.id, id))
      .limit(1);
    if (!video) { res.status(404).json({ error: "Video tidak ditemukan" }); return; }

    const [comment] = await db
      .insert(homeFeedCommentsTable)
      .values({ videoId: id, userId, content: content.trim() })
      .returning();

    const [user] = await db
      .select({ id: usersTable.id, username: usersTable.username, avatar: usersTable.avatar })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    // ── Gamification: award comment EXP (idempotent per comment, daily-limited) ─
    import("../lib/gamification").then(({ awardExp }) =>
      awardExp(userId, "comment", `hf_comment_${comment.id}`, undefined, { videoId: id, commentId: comment.id }).catch(() => {}),
    );

    res.status(201).json({ ...comment, user });
  } catch (err) {
    logger.error({ err, videoId: id }, "Home feed comment failed");
    res.status(500).json({ error: "Gagal mengirim komentar" });
  }
});

// ── POST /home-feed/:id/reward — claim reward (backend-validated) ──────────────
//
// The backend re-computes the total likes/comments and compares against the
// admin-set target. The reward code is ONLY returned when total >= target.
// A user cannot unlock the reward by manipulating the frontend percentage.
router.post("/home-feed/:id/reward", authenticate, async (req, res) => {
  const id = req.params.id as string;

  try {
    const [video] = await db
      .select()
      .from(homeFeedVideosTable)
      .where(eq(homeFeedVideosTable.id, id))
      .limit(1);
    if (!video) { res.status(404).json({ error: "Video tidak ditemukan" }); return; }

    const reward = await computeReward(video);

    if (!reward.isUnlocked) {
      // Not yet unlocked — return progress info but NEVER the code.
      res.json({
        unlocked: false,
        rewardType: reward.rewardType,
        total: reward.total,
        target: reward.target,
        progress: reward.progress,
      });
      return;
    }

    res.json({
      unlocked: true,
      rewardType: reward.rewardType,
      total: reward.total,
      target: reward.target,
      progress: 100,
      rewardCode: video.rewardCode ?? "",
    });
  } catch (err) {
    logger.error({ err, videoId: id }, "Home feed reward claim failed");
    res.status(500).json({ error: "Gagal mengambil reward" });
  }
});

// ── ADMIN: full CRUD (includes inactive/draft videos) ─────────────────────────

// GET /admin/home-feed — list all videos for management
router.get("/admin/home-feed", authenticate, requireRole("admin", "owner"), async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(homeFeedVideosTable)
      .orderBy(asc(homeFeedVideosTable.sortOrder), desc(homeFeedVideosTable.createdAt));

    // Attach live counts for the admin table
    const data = await Promise.all(rows.map(async (v) => {
      const [l] = await db.select({ c: count() }).from(homeFeedLikesTable).where(eq(homeFeedLikesTable.videoId, v.id));
      const [c] = await db.select({ c: count() }).from(homeFeedCommentsTable).where(eq(homeFeedCommentsTable.videoId, v.id));
      const reward = await computeReward(v);
      return { ...v, likeCount: Number(l?.c ?? 0), commentCount: Number(c?.c ?? 0), rewardProgress: reward.progress, rewardUnlocked: reward.isUnlocked };
    }));

    res.json(data);
  } catch (err) {
    logger.error({ err }, "GET /admin/home-feed failed");
    res.json([]);
  }
});

// POST /admin/home-feed — create
router.post("/admin/home-feed", authenticate, requireRole("admin", "owner"), async (req, res) => {
  try {
    const {
      title, description, videoUrl, thumbnail, status = "published",
      isActive = true, sortOrder = 0, rewardType = "NONE", rewardTarget = 0, rewardCode = "",
    } = req.body;

    if (!title?.trim()) { res.status(400).json({ error: "Judul wajib diisi" }); return; }
    if (!videoUrl?.trim()) { res.status(400).json({ error: "Video wajib diupload" }); return; }

    const [video] = await db
      .insert(homeFeedVideosTable)
      .values({
        title: title.trim(),
        description: description?.trim() || null,
        videoUrl: videoUrl.trim(),
        thumbnail: thumbnail || null,
        status,
        isActive: isActive !== false,
        sortOrder: Number(sortOrder) || 0,
        rewardType: (rewardType as any) ?? "NONE",
        rewardTarget: Number(rewardTarget) || 0,
        rewardCode: rewardCode || null,
      })
      .returning();

    res.status(201).json(video);
  } catch (err: any) {
    const pgCode   = err?.code   ?? err?.cause?.code;
    const pgColumn = err?.column ?? err?.cause?.column;
    logger.error({ err, pgCode, body: req.body }, "POST /admin/home-feed failed");

    if (pgCode === "42P01" || pgCode === "42703" || pgCode === "42704") {
      // Table/column/type does not exist — schema not migrated
      res.status(500).json({
        error: "Tabel home_feed_videos belum dibuat di database. Jalankan migrasi database (drizzle-kit push) atau restart server.",
      });
      return;
    }
    if (pgCode === "23502") {
      res.status(400).json({ error: `Data video tidak lengkap: field '${pgColumn ?? "unknown"}' wajib diisi` });
      return;
    }
    if (pgCode === "22P02" || pgCode === "23514") {
      res.status(400).json({ error: "Nilai reward_type tidak valid" });
      return;
    }
    res.status(500).json({ error: "Gagal membuat video. Periksa log server untuk detail." });
  }
});

// PATCH /admin/home-feed/:id — update
router.patch("/admin/home-feed/:id", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const id = req.params.id as string;
  try {
    const [existing] = await db
      .select()
      .from(homeFeedVideosTable)
      .where(eq(homeFeedVideosTable.id, id))
      .limit(1);
    if (!existing) { res.status(404).json({ error: "Video tidak ditemukan" }); return; }

    const updates: any = { updatedAt: new Date() };
    const fields = ["title", "description", "videoUrl", "thumbnail", "status", "rewardCode"] as const;
    for (const f of fields) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }
    if (req.body.isActive !== undefined) updates.isActive = req.body.isActive !== false && req.body.isActive !== "false";
    if (req.body.sortOrder !== undefined) updates.sortOrder = Number(req.body.sortOrder) || 0;
    if (req.body.rewardType !== undefined) updates.rewardType = req.body.rewardType;
    if (req.body.rewardTarget !== undefined) updates.rewardTarget = Number(req.body.rewardTarget) || 0;

    const [updated] = await db
      .update(homeFeedVideosTable)
      .set(updates)
      .where(eq(homeFeedVideosTable.id, id))
      .returning();

    res.json(updated);
  } catch (err: any) {
    const pgCode = err?.code ?? err?.cause?.code;
    logger.error({ err, pgCode, videoId: id }, "PATCH /admin/home-feed failed");
    if (pgCode === "42P01" || pgCode === "42703" || pgCode === "42704") {
      res.status(500).json({ error: "Tabel home_feed_videos belum dibuat di database. Jalankan migrasi database atau restart server." });
      return;
    }
    res.status(500).json({ error: "Gagal memperbarui video. Periksa log server untuk detail." });
  }
});

// DELETE /admin/home-feed/:id
router.delete("/admin/home-feed/:id", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const id = req.params.id as string;
  try {
    await db.delete(homeFeedVideosTable).where(eq(homeFeedVideosTable.id, id));
    res.json({ message: "Deleted" });
  } catch (err: any) {
    const pgCode = err?.code ?? err?.cause?.code;
    logger.error({ err, pgCode, videoId: id }, "DELETE /admin/home-feed failed");
    if (pgCode === "42P01" || pgCode === "42703" || pgCode === "42704") {
      res.status(500).json({ error: "Tabel home_feed_videos belum dibuat di database. Jalankan migrasi database atau restart server." });
      return;
    }
    res.status(500).json({ error: "Gagal menghapus video. Periksa log server untuk detail." });
  }
});

export default router;
