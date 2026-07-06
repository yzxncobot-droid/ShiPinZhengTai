import { Router } from "express";
import { db } from "@workspace/db";
import {
  videosTable, usersTable, categoriesTable, likesTable, viewsTable,
  commentsTable, userSubscriptionsTable, subscriptionsTable,
} from "@workspace/db";
import { eq, and, desc, asc, ilike, gte, or, sql, count } from "drizzle-orm";
import { authenticate, optionalAuth, requireRole } from "../middlewares/auth";

const router = Router();

async function formatVideo(v: any, userId?: number) {
  const [creator] = await db
    .select({ id: usersTable.id, username: usersTable.username, avatar: usersTable.avatar, email: usersTable.email, role: usersTable.role, isBanned: usersTable.isBanned, walletBalance: usersTable.walletBalance, totalTopup: usersTable.totalTopup, totalSpent: usersTable.totalSpent, createdAt: usersTable.createdAt })
    .from(usersTable).where(eq(usersTable.id, v.creatorId)).limit(1);
  let category = null;
  if (v.categoryId) {
    const [cat] = await db.select().from(categoriesTable).where(eq(categoriesTable.id, v.categoryId)).limit(1);
    category = cat || null;
  }
  let isLiked = false;
  if (userId) {
    const [like] = await db.select().from(likesTable).where(and(eq(likesTable.videoId, v.id), eq(likesTable.userId, userId))).limit(1);
    isLiked = !!like;
  }
  return { ...v, creator: creator || null, category, isLiked };
}

async function checkAccess(userId: number | undefined, video: any): Promise<boolean> {
  if (video.type === "free") return true;
  if (!userId) return false;
  const now = new Date();
  const [sub] = await db
    .select()
    .from(userSubscriptionsTable)
    .where(and(eq(userSubscriptionsTable.userId, userId), eq(userSubscriptionsTable.isActive, true), gte(userSubscriptionsTable.endDate, now)))
    .limit(1);
  return !!sub;
}

// GET /videos
router.get("/videos", optionalAuth, async (req, res) => {
  const { search, categoryId, type, sort = "newest", page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = parseInt(page) || 1;
  const limitNum = Math.min(parseInt(limit) || 20, 50);
  const offset = (pageNum - 1) * limitNum;

  let baseQuery = db.select().from(videosTable);
  const conditions: any[] = [];
  if (search) conditions.push(ilike(videosTable.title, `%${search}%`));
  if (categoryId) conditions.push(eq(videosTable.categoryId, parseInt(categoryId)));
  if (type && type !== "all") conditions.push(eq(videosTable.type, type as any));

  const orderBy = sort === "popular"
    ? desc(videosTable.views)
    : sort === "trending"
    ? desc(videosTable.likes)
    : desc(videosTable.createdAt);

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const all = where
    ? await db.select({ id: videosTable.id }).from(videosTable).where(where)
    : await db.select({ id: videosTable.id }).from(videosTable);
  const raw = where
    ? await db.select().from(videosTable).where(where).orderBy(orderBy).limit(limitNum).offset(offset)
    : await db.select().from(videosTable).orderBy(orderBy).limit(limitNum).offset(offset);

  const data = await Promise.all(raw.map(v => formatVideo(v, req.user?.userId)));
  res.json({ data, total: all.length, page: pageNum, limit: limitNum });
});

// GET /videos/featured
router.get("/videos/featured", optionalAuth, async (req, res) => {
  const raw = await db.select().from(videosTable).where(eq(videosTable.isFeatured, true)).orderBy(desc(videosTable.createdAt)).limit(5);
  const data = await Promise.all(raw.map(v => formatVideo(v, req.user?.userId)));
  res.json(data);
});

// GET /videos/trending
router.get("/videos/trending", optionalAuth, async (req, res) => {
  const raw = await db.select().from(videosTable).orderBy(desc(videosTable.views)).limit(10);
  const data = await Promise.all(raw.map(v => formatVideo(v, req.user?.userId)));
  res.json(data);
});

// POST /videos
router.post("/videos", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const { title, description, thumbnail, videoUrl, type = "free", price, categoryId, downloadable = false, isFeatured = false, creatorId } = req.body;
  if (!title || !videoUrl) { res.status(400).json({ error: "Title and videoUrl required" }); return; }
  const finalCreatorId = (req.user!.role === "owner" && creatorId) ? creatorId : req.user!.userId;
  const [video] = await db.insert(videosTable).values({
    title, description, thumbnail, videoUrl, type, price: price || null,
    categoryId: categoryId || null, downloadable, isFeatured,
    creatorId: finalCreatorId,
  }).returning();
  const formatted = await formatVideo(video, req.user!.userId);
  res.status(201).json(formatted);
});

// GET /videos/:id
router.get("/videos/:id", optionalAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const [video] = await db.select().from(videosTable).where(eq(videosTable.id, id)).limit(1);
  if (!video) { res.status(404).json({ error: "Not found" }); return; }
  const hasAccess = await checkAccess(req.user?.userId, video);
  const comments = await db
    .select({
      id: commentsTable.id, videoId: commentsTable.videoId, userId: commentsTable.userId,
      content: commentsTable.content, createdAt: commentsTable.createdAt,
      user: { id: usersTable.id, username: usersTable.username, avatar: usersTable.avatar, email: usersTable.email, role: usersTable.role, isBanned: usersTable.isBanned, walletBalance: usersTable.walletBalance, totalTopup: usersTable.totalTopup, totalSpent: usersTable.totalSpent, createdAt: usersTable.createdAt },
    })
    .from(commentsTable)
    .innerJoin(usersTable, eq(commentsTable.userId, usersTable.id))
    .where(eq(commentsTable.videoId, id))
    .orderBy(desc(commentsTable.createdAt))
    .limit(50);
  const formatted = await formatVideo(video, req.user?.userId);
  res.json({ ...formatted, hasAccess, comments });
});

// PATCH /videos/:id
router.patch("/videos/:id", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const id = parseInt(req.params.id);
  const { title, description, thumbnail, videoUrl, type, price, categoryId, downloadable, isFeatured } = req.body;
  const [video] = await db.select().from(videosTable).where(eq(videosTable.id, id)).limit(1);
  if (!video) { res.status(404).json({ error: "Not found" }); return; }
  if (req.user!.role === "admin" && video.creatorId !== req.user!.userId) {
    res.status(403).json({ error: "Can only edit your own videos" }); return;
  }
  const updates: any = { updatedAt: new Date() };
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (thumbnail !== undefined) updates.thumbnail = thumbnail;
  if (videoUrl !== undefined) updates.videoUrl = videoUrl;
  if (type !== undefined) updates.type = type;
  if (price !== undefined) updates.price = price;
  if (categoryId !== undefined) updates.categoryId = categoryId;
  if (downloadable !== undefined) updates.downloadable = downloadable;
  if (isFeatured !== undefined) updates.isFeatured = isFeatured;
  const [updated] = await db.update(videosTable).set(updates).where(eq(videosTable.id, id)).returning();
  res.json(await formatVideo(updated, req.user!.userId));
});

// DELETE /videos/:id
router.delete("/videos/:id", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const id = parseInt(req.params.id);
  const [video] = await db.select().from(videosTable).where(eq(videosTable.id, id)).limit(1);
  if (!video) { res.status(404).json({ error: "Not found" }); return; }
  if (req.user!.role === "admin" && video.creatorId !== req.user!.userId) {
    res.status(403).json({ error: "Can only delete your own videos" }); return;
  }
  await db.delete(videosTable).where(eq(videosTable.id, id));
  res.json({ message: "Deleted" });
});

// POST /videos/:id/like
router.post("/videos/:id/like", authenticate, async (req, res) => {
  const videoId = parseInt(req.params.id);
  const userId = req.user!.userId;
  const [existing] = await db.select().from(likesTable).where(and(eq(likesTable.videoId, videoId), eq(likesTable.userId, userId))).limit(1);
  if (existing) {
    await db.delete(likesTable).where(and(eq(likesTable.videoId, videoId), eq(likesTable.userId, userId)));
    await db.update(videosTable).set({ likes: sql`${videosTable.likes} - 1` }).where(eq(videosTable.id, videoId));
    const [v] = await db.select({ likes: videosTable.likes }).from(videosTable).where(eq(videosTable.id, videoId)).limit(1);
    res.json({ liked: false, totalLikes: v?.likes || 0 });
  } else {
    await db.insert(likesTable).values({ videoId, userId }).onConflictDoNothing();
    await db.update(videosTable).set({ likes: sql`${videosTable.likes} + 1` }).where(eq(videosTable.id, videoId));
    const [v] = await db.select({ likes: videosTable.likes }).from(videosTable).where(eq(videosTable.id, videoId)).limit(1);
    res.json({ liked: true, totalLikes: v?.likes || 0 });
  }
});

// POST /videos/:id/view
router.post("/videos/:id/view", optionalAuth, async (req, res) => {
  const videoId = parseInt(req.params.id);
  const userId = req.user?.userId || null;
  await db.insert(viewsTable).values({ videoId, userId: userId ?? undefined });
  await db.update(videosTable).set({ views: sql`${videosTable.views} + 1` }).where(eq(videosTable.id, videoId));
  res.json({ message: "View recorded" });
});

// GET /videos/:id/related
router.get("/videos/:id/related", optionalAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const [video] = await db.select().from(videosTable).where(eq(videosTable.id, id)).limit(1);
  const raw = video?.categoryId
    ? await db.select().from(videosTable).where(and(eq(videosTable.categoryId, video.categoryId), sql`${videosTable.id} != ${id}`)).orderBy(desc(videosTable.views)).limit(8)
    : await db.select().from(videosTable).where(sql`${videosTable.id} != ${id}`).orderBy(desc(videosTable.views)).limit(8);
  const data = await Promise.all(raw.map(v => formatVideo(v, req.user?.userId)));
  res.json(data);
});

// GET /videos/:id/comments
router.get("/videos/:id/comments", optionalAuth, async (req, res) => {
  const videoId = parseInt(req.params.id);
  const comments = await db
    .select({
      id: commentsTable.id, videoId: commentsTable.videoId, userId: commentsTable.userId,
      content: commentsTable.content, createdAt: commentsTable.createdAt,
      user: { id: usersTable.id, username: usersTable.username, avatar: usersTable.avatar, email: usersTable.email, role: usersTable.role, isBanned: usersTable.isBanned, walletBalance: usersTable.walletBalance, totalTopup: usersTable.totalTopup, totalSpent: usersTable.totalSpent, createdAt: usersTable.createdAt },
    })
    .from(commentsTable)
    .innerJoin(usersTable, eq(commentsTable.userId, usersTable.id))
    .where(eq(commentsTable.videoId, videoId))
    .orderBy(desc(commentsTable.createdAt))
    .limit(100);
  const [{ total }] = await db.select({ total: count() }).from(commentsTable).where(eq(commentsTable.videoId, videoId));
  res.json({ data: comments, total: Number(total), page: 1, limit: 100 });
});

// POST /videos/:id/comments
router.post("/videos/:id/comments", authenticate, async (req, res) => {
  const videoId = parseInt(req.params.id);
  const userId = req.user!.userId;
  const { content } = req.body;
  if (!content?.trim()) { res.status(400).json({ error: "Content required" }); return; }
  // Verify video exists
  const [vid] = await db.select({ id: videosTable.id }).from(videosTable).where(eq(videosTable.id, videoId)).limit(1);
  if (!vid) { res.status(404).json({ error: "Video not found" }); return; }
  const [comment] = await db.insert(commentsTable).values({ videoId, userId, content: content.trim() }).returning();
  const [user] = await db.select({ id: usersTable.id, username: usersTable.username, avatar: usersTable.avatar, email: usersTable.email, role: usersTable.role, isBanned: usersTable.isBanned, walletBalance: usersTable.walletBalance, totalTopup: usersTable.totalTopup, totalSpent: usersTable.totalSpent, createdAt: usersTable.createdAt }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  res.status(201).json({ ...comment, user });
});

// DELETE /videos/:id/comments/:commentId
router.delete("/videos/:id/comments/:commentId", authenticate, async (req, res) => {
  const commentId = parseInt(req.params.commentId);
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

// GET /history
router.get("/history", authenticate, async (req, res) => {
  const userId = req.user!.userId;
  const { page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = parseInt(page) || 1;
  const limitNum = Math.min(parseInt(limit) || 20, 50);
  const offset = (pageNum - 1) * limitNum;

  // Use a subquery approach to get most-recently-viewed unique videos
  // Group by videoId, get max(createdAt) per video, then sort by that
  const viewedRows = await db.execute(
    sql`SELECT video_id, MAX(created_at) as last_viewed FROM views WHERE user_id = ${userId} AND video_id IS NOT NULL GROUP BY video_id ORDER BY last_viewed DESC LIMIT ${limitNum} OFFSET ${offset}`
  );

  const totalRows = await db.execute(
    sql`SELECT COUNT(DISTINCT video_id) as cnt FROM views WHERE user_id = ${userId} AND video_id IS NOT NULL`
  );

  const rows = viewedRows.rows as Array<{ video_id: number }>;
  const videos = await Promise.all(
    rows.map(async (row) => {
      const [v] = await db.select().from(videosTable).where(eq(videosTable.id, row.video_id)).limit(1);
      return v ? formatVideo(v, userId) : null;
    })
  );

  const total = Number((totalRows.rows[0] as any)?.cnt) || 0;
  res.json({ data: videos.filter(Boolean), total, page: pageNum, limit: limitNum });
});

export default router;
