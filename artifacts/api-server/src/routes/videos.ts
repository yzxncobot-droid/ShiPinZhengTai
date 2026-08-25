import { Router } from "express";
import { db } from "@workspace/db";
import {
  videosTable, usersTable, categoriesTable, likesTable, viewsTable,
  commentsTable, userSubscriptionsTable,
  videoPurchasesTable, transactionsTable, notificationsTable,
  bundlesTable, bundleVideosTable, bundlePurchasesTable,
  walletTransactionsTable, walletsTable, revenueSharesTable,
  customRolesTable, userCustomRolesTable,
} from "@workspace/db";
import { legacyToVisibility, visibilityToLegacy } from "@workspace/db";
import { eq, and, desc, asc, ilike, gte, ne, or, sql, count, isNull } from "drizzle-orm";
import { authenticate, optionalAuth, requireRole } from "../middlewares/auth";
import { incrementVideoViews, resetVideoViewBuffer, invalidateCache, keys, TTL } from "../lib/redis";
import { logger } from "../lib/logger";
import { normalizeUploaderType, resolveStorageType } from "../lib/storage";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

async function formatVideo(v: any, userId?: string) {
  const [creator] = await db
    .select({
      id: usersTable.id, username: usersTable.username, avatar: usersTable.avatar,
      email: usersTable.email, role: usersTable.role, isBanned: usersTable.isBanned,
      walletBalance: usersTable.walletBalance, totalTopup: usersTable.totalTopup,
      totalSpent: usersTable.totalSpent, createdAt: usersTable.createdAt,
    })
    .from(usersTable).where(eq(usersTable.id, v.creatorId)).limit(1);

  let category = null;
  if (v.categoryId) {
    const [cat] = await db.select().from(categoriesTable).where(eq(categoriesTable.id, v.categoryId)).limit(1);
    category = cat || null;
  }

  let isLiked = false;
  if (userId) {
    const [like] = await db.select().from(likesTable)
      .where(and(eq(likesTable.videoId, v.id), eq(likesTable.userId, userId))).limit(1);
    isLiked = !!like;
  }

  return { ...v, creator: creator || null, category, isLiked };
}

/**
 * Determine if a user has access to a given video.
 */
async function checkAccess(userId: string | undefined, video: any): Promise<boolean> {
  const visibility: string = video.visibility ?? legacyToVisibility(video.type, video.bundleExclusive);

  if (visibility === "public") return true;
  if (!userId) return false;

  if (visibility === "premium") {
    const now = new Date();
    const [sub] = await db
      .select()
      .from(userSubscriptionsTable)
      .where(and(
        eq(userSubscriptionsTable.userId, userId),
        eq(userSubscriptionsTable.isActive, true),
        gte(userSubscriptionsTable.endDate, now),
      ))
      .limit(1);
    if (sub) return true;

    const [purchase] = await db
      .select({ id: videoPurchasesTable.id })
      .from(videoPurchasesTable)
      .where(and(eq(videoPurchasesTable.userId, userId), eq(videoPurchasesTable.videoId, video.id)))
      .limit(1);
    return !!purchase;
  }

  if (visibility === "hidden_bundle") {
    if (video.price) {
      const [purchase] = await db
        .select({ id: videoPurchasesTable.id })
        .from(videoPurchasesTable)
        .where(and(eq(videoPurchasesTable.userId, userId), eq(videoPurchasesTable.videoId, video.id)))
        .limit(1);
      if (purchase) return true;
    }
    const [bundlePurchase] = await db
      .select({ id: bundlePurchasesTable.id })
      .from(bundlePurchasesTable)
      .innerJoin(bundleVideosTable, eq(bundleVideosTable.bundleId, bundlePurchasesTable.bundleId))
      .where(and(eq(bundlePurchasesTable.userId, userId), eq(bundleVideosTable.videoId, video.id)))
      .limit(1);
    return !!bundlePurchase;
  }

  return false;
}

/** Derive and sync visibility ↔ legacy fields on the incoming request body. */
function normalizeVisibility(body: any): Record<string, any> {
  const updates: Record<string, any> = {};
  if (body.visibility) {
    updates.visibility = body.visibility;
    const legacy = visibilityToLegacy(body.visibility);
    updates.type = legacy.type;
    updates.bundleExclusive = legacy.bundleExclusive;
  } else if (body.type !== undefined || body.bundleExclusive !== undefined) {
    const resolved = legacyToVisibility(body.type, body.bundleExclusive);
    updates.visibility = resolved;
    updates.type = body.type ?? (resolved === "public" ? "free" : "premium");
    updates.bundleExclusive = body.bundleExclusive ?? (resolved === "hidden_bundle");
  }
  return updates;
}

// ── GET /videos — list/search videos ─────────────────────────────────────────
router.get("/videos", optionalAuth, async (req, res) => {
  try {
    const {
      search, categoryId, visibility, type, isFeatured,
      page = "1", limit = "20", sort = "createdAt", order = "desc",
    } = req.query as Record<string, string>;

    const pageNum = parseInt(page) || 1;
    const limitNum = Math.min(parseInt(limit) || 20, 100);
    const offset = (pageNum - 1) * limitNum;
    const userId = req.user?.userId;
    const isStaff = req.user && ["admin", "owner"].includes(req.user.role);

    const conditions: any[] = [isNull(videosTable.deletedAt)];

    // Non-staff only see published, non-hidden-bundle videos
    if (!isStaff) {
      conditions.push(eq(videosTable.status, "published"));
      conditions.push(ne(videosTable.visibility, "hidden_bundle"));
    }

    if (search) conditions.push(ilike(videosTable.title, `%${search}%`));
    if (categoryId) conditions.push(eq(videosTable.categoryId, categoryId));
    if (visibility) conditions.push(eq(videosTable.visibility, visibility as any));
    if (type) conditions.push(eq(videosTable.type, type as any));
    if (isFeatured === "true") conditions.push(eq(videosTable.isFeatured, true));

    const where = and(...conditions);

    const [{ total }] = await db.select({ total: count() }).from(videosTable).where(where);

    // Map friendly sort names to actual columns
    const sortColMap: Record<string, any> = {
      newest: videosTable.createdAt,
      popular: videosTable.views,
      trending: videosTable.views,
      createdAt: videosTable.createdAt,
      views: videosTable.views,
      likes: videosTable.likes,
      price: videosTable.price,
    };
    const sortCol = sortColMap[sort] ?? videosTable.createdAt;
    const orderFn = order === "asc" ? asc : desc;

    const rows = await db.select().from(videosTable)
      .where(where)
      .orderBy(orderFn(sortCol))
      .limit(limitNum)
      .offset(offset);

    const data = await Promise.all(rows.map((v: any) => formatVideo(v, userId)));
    res.json({ data, total: Number(total), page: pageNum, limit: limitNum });
  } catch (err) {
    logger.error({ err }, "GET /videos failed");
    res.json({ data: [], total: 0, page: 1, limit: 20 });
  }
});

// ── GET /videos/featured ──────────────────────────────────────────────────────
router.get("/videos/featured", optionalAuth, async (req, res) => {
  try {
    const userId = req.user?.userId;
    const rows = await db.select().from(videosTable)
      .where(and(
        eq(videosTable.isFeatured, true),
        eq(videosTable.status, "published"),
        ne(videosTable.visibility, "hidden_bundle"),
        isNull(videosTable.deletedAt),
      ))
      .orderBy(desc(videosTable.createdAt))
      .limit(10);
    const data = await Promise.all(rows.map((v: any) => formatVideo(v, userId)));
    res.json(data);
  } catch (err) {
    logger.error({ err }, "GET /videos/featured failed");
    res.json([]);
  }
});

// ── GET /videos/:id ───────────────────────────────────────────────────────────
router.get("/videos/:id", optionalAuth, async (req, res) => {
  const id = req.params.id as string;
  const userId = req.user?.userId;

  const [video] = await db.select().from(videosTable)
    .where(and(eq(videosTable.id, id), isNull(videosTable.deletedAt))).limit(1);
  if (!video) { res.status(404).json({ error: "Not found" }); return; }

  const isStaff = req.user && ["admin", "owner"].includes(req.user.role);
  const isCreator = userId === video.creatorId;

  if (!isStaff && !isCreator && video.status !== "published") {
    res.status(404).json({ error: "Not found" }); return;
  }

  const hasAccess = await checkAccess(userId, video);
  const formatted = await formatVideo(video, userId);

  res.json({ ...formatted, hasAccess });
});

// ── POST /videos/:id/view — record a view ─────────────────────────────────────
router.post("/videos/:id/view", optionalAuth, async (req, res) => {
  const id = req.params.id as string;
  const userId = req.user?.userId;

  const [video] = await db.select({ id: videosTable.id, visibility: videosTable.visibility })
    .from(videosTable).where(and(eq(videosTable.id, id), isNull(videosTable.deletedAt))).limit(1);
  if (!video) { res.status(404).json({ error: "Not found" }); return; }

  // Increment Redis counter for real-time view tracking
  const bufferedCount = await incrementVideoViews(id);

  // Flush to DB every 10 views (or on first view), then reset the counter so
  // the next flush only adds the delta instead of double-counting.
  if (bufferedCount === 1 || bufferedCount % 10 === 0) {
    await db.update(videosTable)
      .set({ views: sql`${videosTable.views} + ${bufferedCount}` })
      .where(eq(videosTable.id, id));
    await resetVideoViewBuffer(id);
  }

  // Record individual view in DB
  await db.insert(viewsTable).values({ videoId: id, userId: userId ?? null });

  res.json({ message: "View recorded", bufferedViews: bufferedCount });
});

// ── POST /videos — create video (admin/owner) ─────────────────────────────────
router.post("/videos", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const userId = req.user!.userId;
  try {
    const {
      title, description, thumbnail, videoUrl, videoSourceType, videoFilePath,
      price, downloadable, isFeatured, categoryId, tags, duration, scheduledAt, status = "published",
      uploaderType, thumbnailPath, storageFolder, bucketName,
      // Multi-storage provider tracking
      videoStorageProvider, bunnyVideoId, bunnyPlaybackUrl, bunnyLibraryId,
    } = req.body;

    // ── Required field guards ─────────────────────────────────────────────────
    if (!title?.trim()) {
      res.status(400).json({ error: "Judul video wajib diisi" }); return;
    }
    if (!videoUrl?.trim()) {
      res.status(400).json({ error: "Video wajib diupload atau link video wajib diisi" }); return;
    }

    // ── Type coercion & validation ────────────────────────────────────────────
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    // creator_id: must be a valid UUID (comes from JWT — guard against token corruption)
    if (!userId || !uuidPattern.test(userId)) {
      logger.error({ userId }, "POST /videos — creator_id is not a valid UUID");
      res.status(401).json({ error: "Sesi tidak valid, silakan login ulang" }); return;
    }

    // category_id: must be a non-empty UUID string or null
    const safeCategoryId: string | null =
      categoryId && typeof categoryId === "string" && categoryId.trim() !== ""
        ? categoryId.trim()
        : null;
    if (safeCategoryId && !uuidPattern.test(safeCategoryId)) {
      res.status(400).json({ error: "Format category_id tidak valid" }); return;
    }

    // price: must be a finite non-negative number when provided
    const safePrice: number | null = price !== undefined && price !== null && price !== ""
      ? Number(price)
      : null;
    if (safePrice !== null && (!Number.isFinite(safePrice) || safePrice < 0)) {
      res.status(400).json({ error: "Harga tidak valid" }); return;
    }

    // boolean fields: coerce from string "true"/"false" that forms may send
    const safeDownloadable = downloadable === true || downloadable === "true";
    const safeIsFeatured   = isFeatured   === true || isFeatured   === "true";

    // ── FK existence checks ───────────────────────────────────────────────────

    // Verify creator exists in DB (shouldn't fail in practice but confirms FK)
    const [creatorRow] = await db.select({ id: usersTable.id })
      .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!creatorRow) {
      logger.error({ userId }, "POST /videos — creator_id not found in users table");
      res.status(401).json({ error: "Akun tidak ditemukan, silakan login ulang" }); return;
    }

    // Verify category exists if provided
    if (safeCategoryId) {
      const [cat] = await db.select({ id: categoriesTable.id })
        .from(categoriesTable).where(eq(categoriesTable.id, safeCategoryId)).limit(1);
      if (!cat) {
        res.status(400).json({ error: "Kategori tidak ditemukan" }); return;
      }
    }

    const visUpdates = normalizeVisibility(req.body);

    // ── Log every insert value before hitting the DB ──────────────────────────
    const insertPayload = {
      title:           title.trim(),
      description:     description?.trim() || null,
      thumbnail:       thumbnail || null,
      videoUrl:        videoUrl.trim(),
      price:           safePrice,
      downloadable:    safeDownloadable,
      isFeatured:      safeIsFeatured,
      categoryId:      safeCategoryId,
      videoSourceType: videoSourceType ?? "upload",
      videoFilePath:   videoFilePath || null,
      tags:            tags ? JSON.stringify(tags) : null,
      duration:        duration ? Number(duration) : null,
      scheduledAt:     scheduledAt ? new Date(scheduledAt) : null,
      status,
      creatorId:       userId,
      visibility:      visUpdates.visibility ?? "public",
      type:            visUpdates.type ?? "free",
      bundleExclusive: visUpdates.bundleExclusive ?? false,
      // Multi-storage metadata (optional — only set when uploaderType is provided)
      uploaderType:         uploaderType         || null,
      thumbnailPath:        thumbnailPath        || null,
      storageFolder:        storageFolder        || null,
      bucketName:           bucketName           || null,
      // Derive storage_type server-side from uploaderType — never trust client-supplied value
      storageType: (() => {
        const normalized = normalizeUploaderType(uploaderType);
        return normalized ? resolveStorageType(normalized) : null;
      })(),
      // Storage provider tracking (set by upload route before calling POST /videos)
      videoStorageProvider: videoStorageProvider || null,
      bunnyVideoId:         bunnyVideoId         || null,
      bunnyPlaybackUrl:     bunnyPlaybackUrl     || null,
      bunnyLibraryId:       bunnyLibraryId       || null,
    };

    logger.info({ insertPayload }, "POST /videos — about to INSERT");

    const [video] = await db.insert(videosTable).values(insertPayload).returning();

    logger.info({ videoId: video.id }, "POST /videos — INSERT succeeded");

    // Invalidate analytics cache (best-effort — Redis may be unavailable)
    await invalidateCache(keys.analytics("overview")).catch(() => {});

    res.status(201).json(await formatVideo(video, userId));
  } catch (err: any) {
    // ── Log full PG error detail for debugging ────────────────────────────────
    const pgCode      = err?.code      ?? err?.cause?.code;
    const pgDetail    = err?.detail    ?? err?.cause?.detail;
    const pgHint      = err?.hint      ?? err?.cause?.hint;
    const pgColumn    = err?.column    ?? err?.cause?.column;
    const pgConstraint = err?.constraint ?? err?.cause?.constraint;
    const pgTable     = err?.table     ?? err?.cause?.table;

    logger.error({
      err,
      userId,
      body: req.body,
      pg: { code: pgCode, detail: pgDetail, hint: pgHint, column: pgColumn, constraint: pgConstraint, table: pgTable },
    }, "POST /videos INSERT failed");

    // ── Sanitized, user-friendly error responses (never expose raw SQL) ───────
    if (pgCode === "23503") {
      // Foreign key violation — which FK?
      if (pgConstraint?.includes("category")) {
        res.status(400).json({ error: "Kategori tidak ditemukan" }); return;
      }
      if (pgConstraint?.includes("creator") || pgConstraint?.includes("user")) {
        res.status(400).json({ error: "Akun tidak ditemukan" }); return;
      }
      res.status(400).json({ error: "Data referensi tidak ditemukan" }); return;
    }
    if (pgCode === "23502") {
      // NOT NULL violation
      res.status(400).json({ error: `Data video tidak lengkap: field '${pgColumn ?? "unknown"}' wajib diisi` }); return;
    }
    if (pgCode === "22P02") {
      // Invalid text representation (e.g. bad UUID or enum value)
      res.status(400).json({ error: "Format data tidak valid (tipe data salah)" }); return;
    }
    if (pgCode === "23514") {
      // Check constraint violation
      res.status(400).json({ error: "Data video tidak memenuhi syarat validasi" }); return;
    }
    if (pgCode === "42703") {
      // Undefined column — schema mismatch
      res.status(500).json({ error: "Skema database tidak sinkron. Hubungi administrator." }); return;
    }
    // Generic fallback — never expose err.message which may contain raw SQL
    res.status(500).json({ error: "Gagal menyimpan video ke database. Coba lagi atau hubungi administrator." });
  }
});

// ── PATCH /videos/:id — update video ─────────────────────────────────────────
router.patch("/videos/:id", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const id = req.params.id as string;
  const userId = req.user!.userId;

  try {
    const [existing] = await db.select().from(videosTable)
      .where(and(eq(videosTable.id, id), isNull(videosTable.deletedAt))).limit(1);
    if (!existing) { res.status(404).json({ error: "Video tidak ditemukan" }); return; }

    const updates: any = { updatedAt: new Date() };
    const scalarFields = [
      "title","description","thumbnail","videoUrl","price","downloadable","isFeatured","tags","duration","status",
      // Multi-storage metadata
      "thumbnailPath","storageFolder","bucketName",
      "videoStorageProvider","bunnyVideoId","bunnyPlaybackUrl","bunnyLibraryId",
    ] as const;
    for (const f of scalarFields) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }
    // uploaderType + storageType: derive storage_type server-side when uploaderType changes
    if (req.body.uploaderType !== undefined) {
      updates.uploaderType = req.body.uploaderType || null;
      const normalized = normalizeUploaderType(req.body.uploaderType);
      updates.storageType = normalized ? resolveStorageType(normalized) : null;
    }
    if (req.body.scheduledAt !== undefined) {
      updates.scheduledAt = req.body.scheduledAt ? new Date(req.body.scheduledAt) : null;
    }

    // categoryId: must be a valid UUID string or null — never parseInt (UUIDs are not integers)
    if (req.body.categoryId !== undefined) {
      const catId = req.body.categoryId;
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!catId || catId === "" || catId === "null") {
        updates.categoryId = null;
      } else if (typeof catId === "string" && uuidRe.test(catId.trim())) {
        updates.categoryId = catId.trim();
      } else {
        logger.warn({ videoId: id, categoryId: catId }, "VIDEO UPDATE: invalid categoryId rejected");
        res.status(400).json({ error: "Format category_id tidak valid. Harus berupa UUID." }); return;
      }
    }

    const visUpdates = normalizeVisibility(req.body);
    Object.assign(updates, visUpdates);

    logger.info({ videoId: id, userId, updates: { ...updates, updatedAt: undefined } }, "VIDEO UPDATE");

    const [updated] = await db.update(videosTable).set(updates).where(eq(videosTable.id, id)).returning();
    res.json(await formatVideo(updated, userId));
  } catch (err: any) {
    const pgCode = err?.code ?? err?.cause?.code;
    logger.error({ err, videoId: id, body: req.body }, "VIDEO UPDATE FAILED");
    if (pgCode === "23503") {
      res.status(400).json({ error: "Kategori tidak ditemukan atau sudah dihapus." }); return;
    }
    if (pgCode === "42703") {
      res.status(500).json({ error: "Skema database tidak sinkron. Hubungi administrator." }); return;
    }
    res.status(500).json({ error: "Gagal memperbarui video. Coba lagi atau hubungi administrator." });
  }
});

// ── DELETE /videos/:id (soft delete) ─────────────────────────────────────────
router.delete("/videos/:id", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const id = req.params.id as string;
  await db.update(videosTable).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(videosTable.id, id));
  await invalidateCache(keys.analytics("overview")).catch(() => {});
  res.json({ message: "Deleted" });
});

// ── POST /videos/:id/like ─────────────────────────────────────────────────────
router.post("/videos/:id/like", authenticate, async (req, res) => {
  const id = req.params.id as string;
  const userId = req.user!.userId;

  try {
    await db.insert(likesTable).values({ videoId: id, userId });
    await db.update(videosTable).set({ likes: sql`${videosTable.likes} + 1` }).where(eq(videosTable.id, id));
    res.json({ liked: true });
  } catch (err: any) {
    const pgCode = err?.code ?? err?.cause?.code;
    if (pgCode === "23505") {
      await db.delete(likesTable).where(and(eq(likesTable.videoId, id), eq(likesTable.userId, userId)));
      await db.update(videosTable).set({ likes: sql`GREATEST(${videosTable.likes} - 1, 0)` }).where(eq(videosTable.id, id));
      res.json({ liked: false });
    } else {
      logger.error({ err }, "Like failed");
      res.status(500).json({ error: "Like failed" });
    }
  }
});

// ── POST /videos/:id/purchase — buy a premium video ──────────────────────────
//
// Tax / premium rates (deducted from creator earnings):
//   Verified Creator  → 25% tax  (creator earns 75% of price)
//   Creator           → 50% tax  (creator earns 50% of price)
//   Admin / Owner     → no tax applied (platform upload)
//
router.post("/videos/:id/purchase", authenticate, async (req, res) => {
  const id = req.params.id as string;
  const userId = req.user!.userId;

  const [video] = await db.select().from(videosTable)
    .where(and(eq(videosTable.id, id), eq(videosTable.status, "published"), isNull(videosTable.deletedAt))).limit(1);
  if (!video) { res.status(404).json({ error: "Not found" }); return; }
  if (!video.price) { res.status(400).json({ error: "Video is not for individual purchase" }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  if (user.walletBalance < video.price) { res.status(400).json({ error: "Insufficient wallet balance" }); return; }

  const [existingPurchase] = await db.select({ id: videoPurchasesTable.id })
    .from(videoPurchasesTable)
    .where(and(eq(videoPurchasesTable.userId, userId), eq(videoPurchasesTable.videoId, id))).limit(1);
  if (existingPurchase) { res.status(400).json({ error: "Already purchased" }); return; }

  // Fetch creator info to calculate tax-based earnings
  const [creator] = video.creatorId
    ? await db.select({
        id: usersTable.id,
        creatorBadge: usersTable.creatorBadge,
        verifiedCreator: usersTable.verifiedCreator,
        walletBalance: usersTable.walletBalance,
      }).from(usersTable).where(eq(usersTable.id, video.creatorId!)).limit(1)
    : [null];

  // Check if creator has an active custom role with a configured revenue share.
  // The highest-priority custom role wins; falls back to hardcoded tier rates.
  let customShareRate: number | null = null;
  let customRoleLabel: string | null = null;
  if (creator) {
    const [topCustomRole] = await db
      .select({ creatorSharePercent: customRolesTable.creatorSharePercent, name: customRolesTable.name })
      .from(userCustomRolesTable)
      .innerJoin(customRolesTable, eq(userCustomRolesTable.roleId, customRolesTable.id))
      .where(
        and(
          eq(userCustomRolesTable.userId, creator.id),
          eq(customRolesTable.isActive, true),
        ),
      )
      .orderBy(desc(customRolesTable.priority))
      .limit(1);
    if (topCustomRole) {
      customShareRate = topCustomRole.creatorSharePercent / 100;
      customRoleLabel = topCustomRole.name;
    }
  }

  // Determine creator earnings after platform tax.
  // Any non-admin/owner uploader is a "creator upload" eligible for revenue
  // share (base roles user/meril, creator, verified_creator, moderator).
  // Admin/owner uploads are platform uploads — no creator share.
  const isCreatorUpload = creator && video.creatorId !== userId &&
    !["admin", "owner"].includes(creator.role);
  const TAX_VERIFIED_CREATOR = 0.25; // 25% platform tax for Verified Creator
  const TAX_CREATOR          = 0.50; // 50% platform tax for Creator
  const defaultTaxRate = creator?.verifiedCreator ? TAX_VERIFIED_CREATOR : TAX_CREATOR;
  // Custom role rate overrides the default tier rate when set
  const taxRate = customShareRate !== null ? (1 - customShareRate) : defaultTaxRate;
  const creatorEarnings = isCreatorUpload
    ? Math.floor(video.price! * (1 - taxRate))
    : 0;

  const newBalance = user.walletBalance - video.price;

  try {
    const result = await db.transaction(async (tx: any) => {
      // Deduct from buyer
      await tx.update(usersTable).set({
        walletBalance: newBalance,
        totalSpent: sql`${usersTable.totalSpent} + ${video.price}`,
        updatedAt: new Date(),
      }).where(eq(usersTable.id, userId));

      await tx.update(walletsTable).set({
        balance: newBalance,
        totalSpent: sql`${walletsTable.totalSpent} + ${video.price}`,
        updatedAt: new Date(),
        lastTransactionAt: new Date(),
      }).where(eq(walletsTable.userId, userId));

      const [purchase] = await tx.insert(videoPurchasesTable).values({
        userId, videoId: id, price: video.price!,
      }).returning();

      await tx.insert(transactionsTable).values({
        userId, type: "purchase", amount: -video.price!,
        description: `Video purchase: ${video.title}`,
        referenceId: purchase.id,
      });

      await tx.insert(walletTransactionsTable).values({
        userId, type: "purchase", amount: -video.price!,
        balanceAfter: newBalance,
        description: `Video purchase: ${video.title}`,
        referenceType: "video",
        referenceId: purchase.id,
      });

      await tx.insert(notificationsTable).values({
        userId, title: "Video Purchased",
        message: `You now have permanent access to "${video.title}".`,
        type: "purchase",
      });

      // ── Insert revenue_share record ─────────────────────────────────────────
      // Always record the split so admin/creator can see history.
      // For admin/owner uploads (no creator) creatorShare = 0, platformShare = price.
      const platformEarnings = video.price! - creatorEarnings;
      const shareRate = isCreatorUpload ? (1 - taxRate) : 0;
      const uploaderRoleLabel = isCreatorUpload
        ? (customRoleLabel ?? (creator!.verifiedCreator ? "verified_creator" : "creator"))
        : "platform";

      // Creator wallet is credited atomically inside this same transaction,
      // so the row is immediately settled — mark it paid with a timestamp.
      await tx.insert(revenueSharesTable).values({
        purchaseId: purchase.id,
        videoId: id,
        creatorId: isCreatorUpload ? video.creatorId! : null,
        buyerId: userId,
        videoPrice: video.price!,
        creatorShare: creatorEarnings,
        platformShare: platformEarnings,
        shareRate,
        creatorRole: uploaderRoleLabel,
        payoutStatus: "paid",
        payoutDate: new Date(),
      });

      // Credit creator earnings (after platform tax)
      if (isCreatorUpload && creatorEarnings > 0) {
        const taxPercent = Math.round(taxRate * 100);
        const creatorNewBalance = (creator!.walletBalance ?? 0) + creatorEarnings;

        await tx.update(usersTable).set({
          walletBalance: creatorNewBalance,
          updatedAt: new Date(),
        }).where(eq(usersTable.id, video.creatorId!));

        await tx.update(walletsTable).set({
          balance: creatorNewBalance,
          totalEarned: sql`${walletsTable.totalEarned} + ${creatorEarnings}`,
          updatedAt: new Date(),
          lastTransactionAt: new Date(),
        }).where(eq(walletsTable.userId, video.creatorId!));

        await tx.insert(walletTransactionsTable).values({
          userId: video.creatorId!,
          type: "revenue_share",
          amount: creatorEarnings,
          balanceAfter: creatorNewBalance,
          description: `Pendapatan video: ${video.title} (tarif premium ${taxPercent}%)`,
          referenceType: "video",
          referenceId: purchase.id,
        });

        await tx.insert(transactionsTable).values({
          userId: video.creatorId!,
          type: "revenue_share",
          amount: creatorEarnings,
          description: `Pendapatan video: ${video.title} (tarif premium ${taxPercent}%)`,
          referenceId: purchase.id,
        });

        await tx.insert(notificationsTable).values({
          userId: video.creatorId!,
          title: "Video Terjual 🎉",
          message: `Video "${video.title}" dibeli. Kamu mendapat Rp ${creatorEarnings.toLocaleString("id-ID")} (tarif premium ${taxPercent}%).`,
          type: "purchase",
        });
      }

      return purchase;
    });

    res.json({ purchase: result, hasAccess: true, newBalance });
  } catch (err: any) {
    const pgCode = err?.code ?? err?.cause?.code;
    if (pgCode === "23505") { res.status(400).json({ error: "Already purchased" }); return; }
    logger.error({ err, userId, videoId: id }, "Video purchase failed");
    res.status(500).json({ error: "Purchase failed" });
  }
});

// ── GET /videos/:id/comments ──────────────────────────────────────────────────
router.get("/videos/:id/comments", async (req, res) => {
  const id = req.params.id as string;
  const rows = await db.select().from(commentsTable)
    .where(eq(commentsTable.videoId, id))
    .orderBy(desc(commentsTable.createdAt))
    .limit(50);

  const data = await Promise.all(rows.map(async (c: any) => {
    const [user] = await db.select({
      id: usersTable.id, username: usersTable.username, avatar: usersTable.avatar,
    }).from(usersTable).where(eq(usersTable.id, c.userId)).limit(1);
    return { ...c, user };
  }));

  res.json(data);
});

// ── POST /videos/:id/comments ─────────────────────────────────────────────────
router.post("/videos/:id/comments", authenticate, async (req, res) => {
  const id = req.params.id as string;
  const userId = req.user!.userId;
  const { content } = req.body;
  if (!content?.trim()) { res.status(400).json({ error: "Content required" }); return; }

  const [comment] = await db.insert(commentsTable).values({ videoId: id, userId, content: content.trim() }).returning();

  const [user] = await db.select({
    id: usersTable.id, username: usersTable.username, avatar: usersTable.avatar,
  }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);

  res.status(201).json({ ...comment, user });
});

// ── DELETE /videos/:id/comments/:commentId ────────────────────────────────────
router.delete("/videos/:id/comments/:commentId", authenticate, async (req, res) => {
  const commentId = req.params.commentId as string;
  const userId = req.user!.userId;
  const role = req.user!.role;

  const [comment] = await db.select().from(commentsTable).where(eq(commentsTable.id, commentId)).limit(1);
  if (!comment) { res.status(404).json({ error: "Not found" }); return; }
  if (comment.userId !== userId && role !== "admin" && role !== "owner") {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  await db.delete(commentsTable).where(eq(commentsTable.id, commentId));
  res.json({ message: "Deleted" });
});

// ── GET /history ──────────────────────────────────────────────────────────────
router.get("/history", authenticate, async (req, res) => {
  const userId = req.user!.userId;
  const { page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = parseInt(page) || 1;
  const limitNum = Math.min(parseInt(limit) || 20, 50);
  const offset = (pageNum - 1) * limitNum;

  const viewedRows = await db.execute(
    sql`SELECT video_id, MAX(created_at) as last_viewed FROM views WHERE user_id = ${userId}::uuid AND video_id IS NOT NULL GROUP BY video_id ORDER BY last_viewed DESC LIMIT ${limitNum} OFFSET ${offset}`,
  );
  const totalRows = await db.execute(
    sql`SELECT COUNT(DISTINCT video_id) as cnt FROM views WHERE user_id = ${userId}::uuid AND video_id IS NOT NULL`,
  );

  const rows = viewedRows.rows as Array<{ video_id: string }>;
  const videos = await Promise.all(
    rows.map(async (row) => {
      const [v] = await db.select().from(videosTable)
        .where(and(eq(videosTable.id, row.video_id), isNull(videosTable.deletedAt))).limit(1);
      return v ? formatVideo(v, userId) : null;
    }),
  );

  const total = Number((totalRows.rows[0] as any)?.cnt) || 0;
  res.json({ data: videos.filter(Boolean), total, page: pageNum, limit: limitNum });
});

export default router;
