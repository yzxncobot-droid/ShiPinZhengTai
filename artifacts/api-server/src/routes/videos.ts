import { Router } from "express";
import { db } from "@workspace/db";
import {
  videosTable, usersTable, categoriesTable, likesTable, viewsTable,
  commentsTable, userSubscriptionsTable,
  videoPurchasesTable, transactionsTable, notificationsTable,
  bundlesTable, bundleVideosTable, bundlePurchasesTable,
  walletTransactionsTable, walletsTable,
} from "@workspace/db";
import { legacyToVisibility, visibilityToLegacy } from "@workspace/db";
import { eq, and, desc, asc, ilike, gte, ne, or, sql, count, isNull } from "drizzle-orm";
import { authenticate, optionalAuth, requireRole } from "../middlewares/auth";
import { incrementVideoViews, invalidateCache, keys, TTL } from "../lib/redis";
import { logger } from "../lib/logger";

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

    const sortCol = (videosTable as any)[sort] ?? videosTable.createdAt;
    const orderFn = order === "asc" ? asc : desc;

    const rows = await db.select().from(videosTable)
      .where(where)
      .orderBy(orderFn(sortCol))
      .limit(limitNum)
      .offset(offset);

    const data = await Promise.all(rows.map((v) => formatVideo(v, userId)));
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
    const data = await Promise.all(rows.map((v) => formatVideo(v, userId)));
    res.json(data);
  } catch (err) {
    logger.error({ err }, "GET /videos/featured failed");
    res.json([]);
  }
});

// ── GET /videos/:id ───────────────────────────────────────────────────────────
router.get("/videos/:id", optionalAuth, async (req, res) => {
  const id = req.params.id;
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
  const id = req.params.id;
  const userId = req.user?.userId;

  const [video] = await db.select({ id: videosTable.id, visibility: videosTable.visibility })
    .from(videosTable).where(and(eq(videosTable.id, id), isNull(videosTable.deletedAt))).limit(1);
  if (!video) { res.status(404).json({ error: "Not found" }); return; }

  // Increment Redis counter for real-time view tracking
  const bufferedCount = await incrementVideoViews(id);

  // Flush to DB every 10 views (or on first view)
  if (bufferedCount === 1 || bufferedCount % 10 === 0) {
    await db.update(videosTable)
      .set({ views: sql`${videosTable.views} + ${bufferedCount}` })
      .where(eq(videosTable.id, id));
    // Note: we keep the Redis counter running — it resets only if we explicitly reset it
  }

  // Record individual view in DB
  await db.insert(viewsTable).values({ videoId: id, userId: userId ?? null });

  res.json({ message: "View recorded", bufferedViews: bufferedCount });
});

// ── POST /videos — create video (admin/owner) ─────────────────────────────────
router.post("/videos", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const userId = req.user!.userId;
  const {
    title, description, thumbnail, videoUrl, price, downloadable,
    isFeatured, categoryId, tags, duration, scheduledAt, status = "published",
  } = req.body;

  if (!title || !videoUrl) {
    res.status(400).json({ error: "title and videoUrl are required" }); return;
  }

  const visUpdates = normalizeVisibility(req.body);

  const [video] = await db.insert(videosTable).values({
    title, description, thumbnail, videoUrl, price, downloadable: !!downloadable,
    isFeatured: !!isFeatured, categoryId: categoryId ?? null,
    tags: tags ? JSON.stringify(tags) : null,
    duration, scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
    status, creatorId: userId,
    visibility: visUpdates.visibility ?? "public",
    type: visUpdates.type ?? "free",
    bundleExclusive: visUpdates.bundleExclusive ?? false,
  }).returning();

  // Invalidate analytics cache
  await invalidateCache(keys.analytics("overview")).catch(() => {});

  res.status(201).json(await formatVideo(video, userId));
});

// ── PATCH /videos/:id — update video ─────────────────────────────────────────
router.patch("/videos/:id", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const id = req.params.id;
  const userId = req.user!.userId;

  const [existing] = await db.select().from(videosTable)
    .where(and(eq(videosTable.id, id), isNull(videosTable.deletedAt))).limit(1);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const updates: any = { updatedAt: new Date() };
  const fields = ["title","description","thumbnail","videoUrl","price","downloadable","isFeatured","categoryId","tags","duration","status"] as const;
  for (const f of fields) {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  }
  if (req.body.scheduledAt !== undefined) updates.scheduledAt = req.body.scheduledAt ? new Date(req.body.scheduledAt) : null;

  const visUpdates = normalizeVisibility(req.body);
  Object.assign(updates, visUpdates);

  const [updated] = await db.update(videosTable).set(updates).where(eq(videosTable.id, id)).returning();
  res.json(await formatVideo(updated, userId));
});

// ── DELETE /videos/:id (soft delete) ─────────────────────────────────────────
router.delete("/videos/:id", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const id = req.params.id;
  await db.update(videosTable).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(videosTable.id, id));
  await invalidateCache(keys.analytics("overview")).catch(() => {});
  res.json({ message: "Deleted" });
});

// ── POST /videos/:id/like ─────────────────────────────────────────────────────
router.post("/videos/:id/like", authenticate, async (req, res) => {
  const id = req.params.id;
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
router.post("/videos/:id/purchase", authenticate, async (req, res) => {
  const id = req.params.id;
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

  const newBalance = user.walletBalance - video.price;

  try {
    const result = await db.transaction(async (tx) => {
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
  const id = req.params.id;
  const rows = await db.select().from(commentsTable)
    .where(eq(commentsTable.videoId, id))
    .orderBy(desc(commentsTable.createdAt))
    .limit(50);

  const data = await Promise.all(rows.map(async (c) => {
    const [user] = await db.select({
      id: usersTable.id, username: usersTable.username, avatar: usersTable.avatar,
    }).from(usersTable).where(eq(usersTable.id, c.userId)).limit(1);
    return { ...c, user };
  }));

  res.json(data);
});

// ── POST /videos/:id/comments ─────────────────────────────────────────────────
router.post("/videos/:id/comments", authenticate, async (req, res) => {
  const id = req.params.id;
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
  const commentId = req.params.commentId;
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
