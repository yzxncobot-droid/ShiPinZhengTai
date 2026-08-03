/**
 * Creator routes — accessible to users with creator_badge = true.
 *
 * creator_badge = true              → can upload videos
 * creator_badge = true + verified_creator = true → can also access My Video dashboard
 */
import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  usersTable, videosTable, categoriesTable, likesTable,
  commentsTable, viewsTable,
} from "@workspace/db";
import { eq, and, desc, count, sql, isNull } from "drizzle-orm";
import { authenticate } from "../middlewares/auth";
import { logger } from "../lib/logger";
import { resolveStorageType } from "../lib/storage";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Fetch the effective creator flags for the authenticated user.
 *
 * Creator capabilities are granted by EITHER:
 *   a) The boolean flag columns (creatorBadge / verifiedCreator), OR
 *   b) The role column ("creator" → creatorBadge; "verified_creator" → both flags)
 *
 * Role takes effect even if the boolean flags are still false, so assigning
 * role = 'creator' or 'verified_creator' is sufficient without also flipping
 * the legacy boolean columns.
 */
async function getCreatorFlags(userId: string) {
  const [row] = await db
    .select({
      creatorBadge:    usersTable.creatorBadge,
      verifiedCreator: usersTable.verifiedCreator,
      role:            usersTable.role,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!row) return { creatorBadge: false, verifiedCreator: false };

  // Derive capabilities from role (role is authoritative over boolean flags)
  const roleIsCreator         = row.role === "creator" || row.role === "verified_creator";
  const roleIsVerifiedCreator = row.role === "verified_creator";

  return {
    creatorBadge:    row.creatorBadge    || roleIsCreator,
    verifiedCreator: row.verifiedCreator || roleIsVerifiedCreator,
  };
}

/** Middleware: reject requests if user doesn't have creator access (badge or role). */
async function requireCreatorBadge(req: Request, res: Response, next: Function) {
  if (!req.user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const flags = await getCreatorFlags(req.user.userId);
  if (!flags.creatorBadge) {
    res.status(403).json({ error: "Creator badge required", code: "NOT_CREATOR" });
    return;
  }
  next();
}

/** Middleware: reject requests if user doesn't have verified creator access. */
async function requireVerifiedCreator(req: Request, res: Response, next: Function) {
  if (!req.user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const flags = await getCreatorFlags(req.user.userId);
  if (!flags.verifiedCreator) {
    res.status(403).json({ error: "Verified creator badge required", code: "NOT_VERIFIED_CREATOR" });
    return;
  }
  next();
}

// ── POST /creator/videos ──────────────────────────────────────────────────────
// Create a new video (creator_badge required)
router.post("/creator/videos", authenticate, requireCreatorBadge, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const {
      title, description, categoryId, visibility = "public",
      bundleId, price, downloadable = false,
      videoSourceType = "upload", videoUrl, videoFilePath, thumbnail,
      tags,
      uploaderType, thumbnailPath, storageFolder, bucketName,
    } = req.body;

    if (!title?.trim()) {
      res.status(400).json({ error: "Title is required" });
      return;
    }
    if (!videoUrl?.trim()) {
      res.status(400).json({ error: "Video URL is required" });
      return;
    }

    // Derive storage_type server-side from DB creator flags — never trust client value.
    // Profile-dropdown uploads for Creator / Verified Creator always go to PUBLIC Supabase.
    const flags = await getCreatorFlags(userId);
    const dbUploaderType = flags.verifiedCreator ? "verified_creator" : "creator";
    const derivedStorageType: "PUBLIC" | "OWNER" = resolveStorageType(dbUploaderType);

    const [video] = await db.insert(videosTable).values({
      title: title.trim(),
      description: description?.trim() ?? null,
      categoryId: categoryId || null,
      visibility: visibility as any,
      type: visibility === "premium" ? "premium" : "free",
      bundleExclusive: visibility === "hidden_bundle",
      price: price ?? null,
      downloadable: !!downloadable,
      videoSourceType: videoSourceType as any,
      videoUrl,
      videoFilePath: videoFilePath ?? null,
      thumbnail: thumbnail ?? null,
      tags: tags ?? null,
      status: "published",  // always publish immediately; never trust client-supplied status
      creatorId: userId,
      // Multi-storage metadata
      uploaderType:  dbUploaderType,          // authoritative server-side value
      thumbnailPath: thumbnailPath || null,
      storageFolder: storageFolder || null,
      bucketName:    bucketName   || null,
      storageType:   derivedStorageType,      // always PUBLIC for creator/verified_creator
    }).returning();

    logger.info({ videoId: video.id, creatorId: userId }, "Creator uploaded video");
    res.status(201).json(video);
  } catch (err) {
    logger.error({ err }, "POST /creator/videos failed");
    res.status(500).json({ error: "Failed to create video" });
  }
});

// ── GET /creator/my-videos ────────────────────────────────────────────────────
// List own videos (creator_badge required)
router.get("/creator/my-videos", authenticate, requireCreatorBadge, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const page  = Math.max(1, Number(req.query.page)  || 1);
    const limit = Math.min(50, Number(req.query.limit) || 15);
    const offset = (page - 1) * limit;

    const [videos, [{ total }]] = await Promise.all([
      db
        .select({
          id: videosTable.id,
          title: videosTable.title,
          description: videosTable.description,
          thumbnail: videosTable.thumbnail,
          videoUrl: videosTable.videoUrl,
          visibility: videosTable.visibility,
          status: videosTable.status,
          views: videosTable.views,
          likes: videosTable.likes,
          downloadable: videosTable.downloadable,
          price: videosTable.price,
          duration: videosTable.duration,
          tags: videosTable.tags,
          videoSourceType: videosTable.videoSourceType,
          categoryId: videosTable.categoryId,
          createdAt: videosTable.createdAt,
          updatedAt: videosTable.updatedAt,
        })
        .from(videosTable)
        .where(and(eq(videosTable.creatorId, userId), isNull(videosTable.deletedAt)))
        .orderBy(desc(videosTable.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: count() })
        .from(videosTable)
        .where(and(eq(videosTable.creatorId, userId), isNull(videosTable.deletedAt))),
    ]);

    // Attach category names
    const categoryIds = [...new Set(videos.map((v) => v.categoryId).filter(Boolean))];
    let categoryMap: Record<string, string> = {};
    if (categoryIds.length > 0) {
      const cats = await db
        .select({ id: categoriesTable.id, name: categoriesTable.name })
        .from(categoriesTable)
        .where(sql`${categoriesTable.id} = ANY(${categoryIds})`);
      categoryMap = Object.fromEntries(cats.map((c) => [c.id, c.name]));
    }

    const data = videos.map((v) => ({
      ...v,
      categoryName: v.categoryId ? (categoryMap[v.categoryId] ?? null) : null,
    }));

    res.json({ data, total: Number(total), page, limit });
  } catch (err) {
    logger.error({ err }, "GET /creator/my-videos failed");
    res.status(500).json({ error: "Failed to fetch videos" });
  }
});

// ── GET /creator/stats ────────────────────────────────────────────────────────
// Aggregate stats for creator's videos (verified_creator required)
router.get("/creator/stats", authenticate, requireVerifiedCreator, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const [row] = await db
      .select({
        totalVideos: count(),
        totalViews: sql<number>`COALESCE(SUM(${videosTable.views}), 0)`,
        totalLikes: sql<number>`COALESCE(SUM(${videosTable.likes}), 0)`,
      })
      .from(videosTable)
      .where(and(eq(videosTable.creatorId, userId), isNull(videosTable.deletedAt)));

    res.json({
      totalVideos: Number(row?.totalVideos ?? 0),
      totalViews:  Number(row?.totalViews  ?? 0),
      totalLikes:  Number(row?.totalLikes  ?? 0),
    });
  } catch (err) {
    logger.error({ err }, "GET /creator/stats failed");
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// ── PATCH /creator/videos/:id ─────────────────────────────────────────────────
// Edit own video (creator_badge required)
router.patch("/creator/videos/:id", authenticate, requireCreatorBadge, async (req: Request, res: Response) => {
  try {
    const userId  = req.user!.userId;
    const videoId = req.params.id;

    const [existing] = await db
      .select({ id: videosTable.id, creatorId: videosTable.creatorId })
      .from(videosTable)
      .where(and(eq(videosTable.id, videoId), isNull(videosTable.deletedAt)))
      .limit(1);

    if (!existing) { res.status(404).json({ error: "Video not found" }); return; }
    if (existing.creatorId !== userId) {
      res.status(403).json({ error: "You can only edit your own videos" });
      return;
    }

    const { title, description, categoryId, visibility, price, downloadable, thumbnail, tags, status } = req.body;
    const updates: Record<string, any> = { updatedAt: new Date() };
    if (title !== undefined)        updates.title = title;
    if (description !== undefined)  updates.description = description;
    if (categoryId !== undefined)   updates.categoryId = categoryId || null;
    if (visibility !== undefined) {
      updates.visibility = visibility;
      updates.type = visibility === "premium" ? "premium" : "free";
      updates.bundleExclusive = visibility === "hidden_bundle";
    }
    if (price !== undefined)        updates.price = price;
    if (downloadable !== undefined) updates.downloadable = downloadable;
    if (thumbnail !== undefined)    updates.thumbnail = thumbnail;
    if (tags !== undefined)         updates.tags = tags;
    if (status !== undefined)       updates.status = status;

    const [updated] = await db.update(videosTable).set(updates).where(eq(videosTable.id, videoId)).returning();
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "PATCH /creator/videos/:id failed");
    res.status(500).json({ error: "Failed to update video" });
  }
});

// ── DELETE /creator/videos/:id ────────────────────────────────────────────────
// Soft-delete own video (creator_badge required)
router.delete("/creator/videos/:id", authenticate, requireCreatorBadge, async (req: Request, res: Response) => {
  try {
    const userId  = req.user!.userId;
    const videoId = req.params.id;

    const [existing] = await db
      .select({ id: videosTable.id, creatorId: videosTable.creatorId })
      .from(videosTable)
      .where(and(eq(videosTable.id, videoId), isNull(videosTable.deletedAt)))
      .limit(1);

    if (!existing) { res.status(404).json({ error: "Video not found" }); return; }
    if (existing.creatorId !== userId) {
      res.status(403).json({ error: "You can only delete your own videos" });
      return;
    }

    await db.update(videosTable).set({ deletedAt: new Date() }).where(eq(videosTable.id, videoId));
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "DELETE /creator/videos/:id failed");
    res.status(500).json({ error: "Failed to delete video" });
  }
});

// ── PATCH /admin/users/:id/creator-badge ──────────────────────────────────────
// Grant/revoke creator badges (admin/owner only)
router.patch("/admin/users/:id/creator-badge", authenticate, async (req: Request, res: Response) => {
  try {
    if (!req.user || !["admin", "owner"].includes(req.user.role)) {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    const { creatorBadge, verifiedCreator } = req.body;
    const updates: Record<string, any> = { updatedAt: new Date() };
    if (typeof creatorBadge === "boolean")    updates.creatorBadge    = creatorBadge;
    if (typeof verifiedCreator === "boolean") updates.verifiedCreator = verifiedCreator;

    if (Object.keys(updates).length <= 1) {
      res.status(400).json({ error: "Provide creatorBadge or verifiedCreator" });
      return;
    }

    const [updated] = await db
      .update(usersTable)
      .set(updates)
      .where(eq(usersTable.id, req.params.id))
      .returning({
        id: usersTable.id,
        username: usersTable.username,
        creatorBadge: usersTable.creatorBadge,
        verifiedCreator: usersTable.verifiedCreator,
      });

    if (!updated) { res.status(404).json({ error: "User not found" }); return; }
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "PATCH /admin/users/:id/creator-badge failed");
    res.status(500).json({ error: "Failed to update creator badge" });
  }
});

export default router;
