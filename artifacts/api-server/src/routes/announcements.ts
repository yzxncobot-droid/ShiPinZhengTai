import { Router } from "express";
import { db } from "@workspace/db";
import {
  announcementsTable, announcementReactionsTable,
  announcementCommentsTable, announcementReadsTable,
} from "@workspace/db";
import { eq, desc, and, sql, inArray } from "drizzle-orm";
import { usersTable } from "@workspace/db";
import { authenticate, optionalAuth, requireRole } from "../middlewares/auth";

const router = Router();

// ── Helper ────────────────────────────────────────────────────────────────────

async function enrichAnnouncements(rows: any[], userId?: string) {
  if (!rows.length) return [];

  const ids = rows.map((r: any) => r.id);

  // Reactions grouped
  const reactions = await db
    .select({
      announcementId: announcementReactionsTable.announcementId,
      emoji: announcementReactionsTable.emoji,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(announcementReactionsTable)
    .where(inArray(announcementReactionsTable.announcementId, ids))
    .groupBy(announcementReactionsTable.announcementId, announcementReactionsTable.emoji);

  // Comment counts
  const commentCounts = await db
    .select({
      announcementId: announcementCommentsTable.announcementId,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(announcementCommentsTable)
    .where(inArray(announcementCommentsTable.announcementId, ids))
    .groupBy(announcementCommentsTable.announcementId);

  // User's own reactions
  const myReactions = userId
    ? await db
        .select({ announcementId: announcementReactionsTable.announcementId, emoji: announcementReactionsTable.emoji })
        .from(announcementReactionsTable)
        .where(and(
          inArray(announcementReactionsTable.announcementId, ids),
          eq(announcementReactionsTable.userId, userId),
        ))
    : [];

  return rows.map((ann: any) => {
    const annReactions = reactions.filter((r: any) => r.announcementId === ann.id);
    const commentCount = commentCounts.find((c: any) => c.announcementId === ann.id)?.count ?? 0;
    const myEmojis = myReactions.filter((r: any) => r.announcementId === ann.id).map((r: any) => r.emoji);

    return {
      ...ann,
      reactions: annReactions,
      commentCount,
      myReactions: myEmojis,
    };
  });
}

// ── List announcements ────────────────────────────────────────────────────────

router.get("/announcements", optionalAuth, async (req, res) => {
  try {
    const userId = req.user?.userId;
    const page = Math.max(1, parseInt(String(req.query.page ?? "1")));
    const limit = Math.min(50, parseInt(String(req.query.limit ?? "20")));
    const offset = (page - 1) * limit;

    const rows = await db
      .select({
        id: announcementsTable.id,
        title: announcementsTable.title,
        content: announcementsTable.content,
        imageUrl: announcementsTable.imageUrl,
        videoUrl: announcementsTable.videoUrl,
        linkUrl: announcementsTable.linkUrl,
        linkLabel: announcementsTable.linkLabel,
        isPinned: announcementsTable.isPinned,
        visibility: announcementsTable.visibility,
        createdAt: announcementsTable.createdAt,
        updatedAt: announcementsTable.updatedAt,
        authorUsername: usersTable.username,
        authorAvatar: usersTable.avatar,
      })
      .from(announcementsTable)
      .innerJoin(usersTable, eq(announcementsTable.createdBy, usersTable.id))
      .orderBy(desc(announcementsTable.isPinned), desc(announcementsTable.createdAt))
      .limit(limit)
      .offset(offset);

    const enriched = await enrichAnnouncements(rows, userId);
    res.json(enriched);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Get single announcement ────────────────────────────────────────────────────

router.get("/announcements/:id", optionalAuth, async (req, res) => {
  try {
    const id = req.params.id as string;
    const userId = req.user?.userId;

    const [row] = await db
      .select({
        id: announcementsTable.id,
        title: announcementsTable.title,
        content: announcementsTable.content,
        imageUrl: announcementsTable.imageUrl,
        videoUrl: announcementsTable.videoUrl,
        linkUrl: announcementsTable.linkUrl,
        linkLabel: announcementsTable.linkLabel,
        isPinned: announcementsTable.isPinned,
        visibility: announcementsTable.visibility,
        createdAt: announcementsTable.createdAt,
        updatedAt: announcementsTable.updatedAt,
        authorUsername: usersTable.username,
        authorAvatar: usersTable.avatar,
      })
      .from(announcementsTable)
      .innerJoin(usersTable, eq(announcementsTable.createdBy, usersTable.id))
      .where(eq(announcementsTable.id, id));

    if (!row) { res.status(404).json({ error: "Not found" }); return; }

    const [enriched] = await enrichAnnouncements([row], userId);
    res.json(enriched);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Create announcement (owner only) ─────────────────────────────────────────

router.post("/announcements", authenticate, requireRole("owner"), async (req, res) => {
  try {
    const { title, content, imageUrl, videoUrl, linkUrl, linkLabel, isPinned, visibility } = req.body;

    if (!title?.trim() || !content?.trim()) {
      res.status(400).json({ error: "title and content are required" });
      return;
    }

    const [created] = await db.insert(announcementsTable).values({
      title: title.trim(),
      content: content.trim(),
      imageUrl: imageUrl || null,
      videoUrl: videoUrl || null,
      linkUrl: linkUrl || null,
      linkLabel: linkLabel || null,
      isPinned: !!isPinned,
      visibility: visibility ?? "all",
      createdBy: req.user!.userId,
    }).returning();

    res.status(201).json(created);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Update announcement (owner only) ─────────────────────────────────────────

router.patch("/announcements/:id", authenticate, requireRole("owner"), async (req, res) => {
  try {
    const id = req.params.id as string;
    const { title, content, imageUrl, videoUrl, linkUrl, linkLabel, isPinned, visibility } = req.body;

    const updates: Record<string, any> = { updatedAt: new Date() };
    if (title !== undefined) updates.title = title.trim();
    if (content !== undefined) updates.content = content.trim();
    if (imageUrl !== undefined) updates.imageUrl = imageUrl || null;
    if (videoUrl !== undefined) updates.videoUrl = videoUrl || null;
    if (linkUrl !== undefined) updates.linkUrl = linkUrl || null;
    if (linkLabel !== undefined) updates.linkLabel = linkLabel || null;
    if (isPinned !== undefined) updates.isPinned = !!isPinned;
    if (visibility !== undefined) updates.visibility = visibility;

    const [updated] = await db.update(announcementsTable)
      .set(updates)
      .where(eq(announcementsTable.id, id))
      .returning();

    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Delete announcement (owner only) ─────────────────────────────────────────

router.delete("/announcements/:id", authenticate, requireRole("owner"), async (req, res) => {
  try {
    await db.delete(announcementsTable).where(eq(announcementsTable.id, req.params.id as string));
    res.json({ message: "Deleted" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Reactions ─────────────────────────────────────────────────────────────────

router.post("/announcements/:id/react", authenticate, async (req, res) => {
  try {
    const { emoji } = req.body;
    if (!emoji) { res.status(400).json({ error: "emoji required" }); return; }

    const userId = req.user!.userId;
    const announcementId = req.params.id as string;

    // Toggle: delete if exists, else insert
    const existing = await db
      .select()
      .from(announcementReactionsTable)
      .where(and(
        eq(announcementReactionsTable.announcementId, announcementId),
        eq(announcementReactionsTable.userId, userId),
        eq(announcementReactionsTable.emoji, emoji),
      ))
      .limit(1);

    if (existing.length > 0) {
      await db.delete(announcementReactionsTable)
        .where(and(
          eq(announcementReactionsTable.announcementId, announcementId),
          eq(announcementReactionsTable.userId, userId),
          eq(announcementReactionsTable.emoji, emoji),
        ));
      res.json({ toggled: false });
    } else {
      await db.insert(announcementReactionsTable).values({ announcementId, userId, emoji });
      res.json({ toggled: true });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Comments ─────────────────────────────────────────────────────────────────

router.get("/announcements/:id/comments", optionalAuth, async (req, res) => {
  try {
    const comments = await db
      .select({
        id: announcementCommentsTable.id,
        content: announcementCommentsTable.content,
        createdAt: announcementCommentsTable.createdAt,
        updatedAt: announcementCommentsTable.updatedAt,
        authorUsername: usersTable.username,
        authorAvatar: usersTable.avatar,
        authorId: announcementCommentsTable.userId,
      })
      .from(announcementCommentsTable)
      .innerJoin(usersTable, eq(announcementCommentsTable.userId, usersTable.id))
      .where(eq(announcementCommentsTable.announcementId, req.params.id as string))
      .orderBy(desc(announcementCommentsTable.createdAt))
      .limit(50);

    res.json(comments);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Only the owner can send messages in the announcement chat thread.
// All other roles (admins, moderators, regular users) can read but not post.
router.post("/announcements/:id/comments", authenticate, requireRole("owner"), async (req, res) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) { res.status(400).json({ error: "content required" }); return; }

    const [created] = await db.insert(announcementCommentsTable).values({
      announcementId: req.params.id as string,
      userId: req.user!.userId,
      content: content.trim(),
    }).returning();

    const [author] = await db.select({ username: usersTable.username, avatar: usersTable.avatar })
      .from(usersTable).where(eq(usersTable.id, req.user!.userId));

    res.status(201).json({ ...created, authorUsername: author.username, authorAvatar: author.avatar });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/announcements/:id/comments/:commentId", authenticate, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const role = req.user!.role;
    const { commentId  } = req.params as { commentId: string };

    const [comment] = await db.select().from(announcementCommentsTable)
      .where(eq(announcementCommentsTable.id, commentId));

    if (!comment) { res.status(404).json({ error: "Not found" }); return; }
    if (comment.userId !== userId && !["admin", "owner"].includes(role)) {
      res.status(403).json({ error: "Forbidden" }); return;
    }

    await db.delete(announcementCommentsTable).where(eq(announcementCommentsTable.id, commentId));
    res.json({ message: "Deleted" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Mark as read ──────────────────────────────────────────────────────────────

router.post("/announcements/:id/read", authenticate, async (req, res) => {
  try {
    await db.insert(announcementReadsTable).values({
      announcementId: req.params.id as string,
      userId: req.user!.userId,
    }).onConflictDoNothing();
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Unread count ──────────────────────────────────────────────────────────────

router.get("/announcements-unread", authenticate, async (req, res) => {
  try {
    const userId = req.user!.userId;

    const [result] = await db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(announcementsTable)
      .where(sql`${announcementsTable.id} not in (
        select announcement_id from ${announcementReadsTable}
        where user_id = ${userId}
      )`);

    res.json({ unread: result?.count ?? 0 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
