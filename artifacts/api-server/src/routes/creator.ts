/**
 * Creator routes — accessible to users whose active custom role has the
 * required permission (permUploadVideo / permMyVideo).
 *
 * Permission source: custom_roles table (permUploadVideo, permMyVideo).
 * Admin / Owner always bypass permission checks.
 */
import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  usersTable, videosTable, categoriesTable, likesTable,
  commentsTable, viewsTable, customRolesTable, userCustomRolesTable,
} from "@workspace/db";
import { eq, and, desc, count, sql, isNull } from "drizzle-orm";
import { authenticate } from "../middlewares/auth";
import { logger } from "../lib/logger";
import { resolveStorageType } from "../lib/storage";

const router = Router();

// ── Permission middleware factory ─────────────────────────────────────────────

/**
 * Middleware factory: rejects request unless the authenticated user has the
 * given permission in at least one of their active custom roles.
 *
 * Admin and owner roles bypass this check entirely.
 */
function requirePermission(perm: "permUploadVideo" | "permMyVideo") {
  return async (req: Request, res: Response, next: Function) => {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { role, userId } = req.user;

    // Admin / Owner always have access
    if (role === "admin" || role === "owner") {
      next();
      return;
    }

    // Base roles (user/meril) can upload & manage their videos by default
    if (role === "user" || role === "meril") {
      next();
      return;
    }

    // Check if ANY active custom role assigned to this user has the permission
    try {
      const rows = await db
        .select({ perm: customRolesTable[perm] })
        .from(userCustomRolesTable)
        .innerJoin(customRolesTable, eq(userCustomRolesTable.roleId, customRolesTable.id))
        .where(and(
          eq(userCustomRolesTable.userId, userId),
          eq(customRolesTable.isActive, true),
        ));

      const hasPerm = rows.some((r) => r.perm === true);
      if (!hasPerm) {
        const label = perm === "permUploadVideo" ? "Upload" : "My Video";
        res.status(403).json({
          error: `Role kamu belum memiliki permission ${label}.`,
          code: "NO_PERMISSION",
          permission: perm,
        });
        return;
      }
    } catch (err) {
      logger.error({ err, perm }, "requirePermission: DB check failed");
      res.status(500).json({ error: "Gagal memeriksa izin akses." });
      return;
    }

    next();
  };
}

// ── POST /creator/videos ──────────────────────────────────────────────────────
// Create a new video (upload permission required)
router.post("/creator/videos", authenticate, requirePermission("permUploadVideo"), async (req: Request, res: Response) => {
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

    // Derive storage_type server-side — never trust client value.
    // Admin/owner use their dedicated upload flow (explicit uploaderType via admin page).
    // All other users (custom-role creators) → PUBLIC Supabase.
    const userRole = req.user!.role;
    const isAdminOrOwner = userRole === "admin" || userRole === "owner";
    const dbUploaderType = isAdminOrOwner ? (uploaderType ?? "owner") : "creator";
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
      uploaderType:  dbUploaderType,
      thumbnailPath: thumbnailPath || null,
      storageFolder: storageFolder || null,
      bucketName:    bucketName   || null,
      storageType:   derivedStorageType,
    }).returning();

    logger.info({ videoId: video.id, creatorId: userId }, "Creator uploaded video");
    res.status(201).json(video);
  } catch (err: any) {
    const pgCode   = err?.code   ?? err?.cause?.code;
    const pgColumn = err?.column ?? err?.cause?.column;
    logger.error({ err, pgCode, body: req.body }, "POST /creator/videos failed");

    if (pgCode === "42P01" || pgCode === "42703" || pgCode === "42704") {
      res.status(500).json({ error: "Skema database tidak sinkron. Jalankan migrasi database atau restart server." });
      return;
    }
    if (pgCode === "23502") {
      res.status(400).json({ error: `Data video tidak lengkap: field '${pgColumn ?? "unknown"}' wajib diisi` });
      return;
    }
    if (pgCode === "23503") {
      res.status(400).json({ error: "Kategori tidak ditemukan" });
      return;
    }
    res.status(500).json({ error: "Gagal membuat video. Periksa log server untuk detail." });
  }
});

// ── GET /creator/my-videos ────────────────────────────────────────────────────
// List own videos (my_video permission required)
router.get("/creator/my-videos", authenticate, requirePermission("permMyVideo"), async (req: Request, res: Response) => {
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
    const categoryIds = [...new Set(videos.map((v: any) => v.categoryId).filter(Boolean))];
    let categoryMap: Record<string, string> = {};
    if (categoryIds.length > 0) {
      const cats = await db
        .select({ id: categoriesTable.id, name: categoriesTable.name })
        .from(categoriesTable)
        .where(sql`${categoriesTable.id} = ANY(${categoryIds})`);
      categoryMap = Object.fromEntries(cats.map((c: any) => [c.id, c.name]));
    }

    const data = videos.map((v: any) => ({
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
// Aggregate stats for creator's videos (my_video permission required)
router.get("/creator/stats", authenticate, requirePermission("permMyVideo"), async (req: Request, res: Response) => {
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
// Edit own video (upload permission required)
router.patch("/creator/videos/:id", authenticate, requirePermission("permUploadVideo"), async (req: Request, res: Response) => {
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
// Soft-delete own video (upload permission required)
router.delete("/creator/videos/:id", authenticate, requirePermission("permUploadVideo"), async (req: Request, res: Response) => {
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

export default router;
