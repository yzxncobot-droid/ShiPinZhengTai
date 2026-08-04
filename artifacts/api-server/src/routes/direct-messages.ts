import { Router } from "express";
import { db } from "@workspace/db";
import {
  conversationsTable, conversationMembersTable, directMessagesTable,
  dmReactionsTable, dmReadsTable,
} from "@workspace/db";
import { eq, desc, and, sql, inArray, or, gt, lt, ne } from "drizzle-orm";
import { usersTable } from "@workspace/db";
import { authenticate } from "../middlewares/auth";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Helper: get or create conversation between two users ──────────────────────

async function getOrCreateConversation(userA: string, userB: string) {
  // Find existing conversation where both are members
  const existing = await db
    .select({ conversationId: conversationMembersTable.conversationId })
    .from(conversationMembersTable)
    .where(eq(conversationMembersTable.userId, userA));

  const userAConvIds = existing.map((e: any) => e.conversationId);

  if (userAConvIds.length > 0) {
    const shared = await db
      .select({ conversationId: conversationMembersTable.conversationId })
      .from(conversationMembersTable)
      .where(and(
        inArray(conversationMembersTable.conversationId, userAConvIds),
        eq(conversationMembersTable.userId, userB),
      ));

    if (shared.length > 0) {
      return shared[0].conversationId;
    }
  }

  // Create new
  const [conv] = await db.insert(conversationsTable).values({}).returning();
  await db.insert(conversationMembersTable).values([
    { conversationId: conv.id, userId: userA },
    { conversationId: conv.id, userId: userB },
  ]);
  return conv.id;
}

// ── List conversations ─────────────────────────────────────────────────────────

router.get("/dm/conversations", authenticate, async (req, res) => {
  try {
    const userId = req.user!.userId;

    // Get all conversation IDs for this user
    const memberships = await db
      .select()
      .from(conversationMembersTable)
      .where(and(
        eq(conversationMembersTable.userId, userId),
        eq(conversationMembersTable.isBlocked, false),
      ));

    if (!memberships.length) { res.json([]); return; }

    const convIds = memberships.map((m: any) => m.conversationId);

    // Get last message per conversation
    const convs = await Promise.all(convIds.map(async (convId: any) => {
      const membership = memberships.find((m: any) => m.conversationId === convId)!;

      // Other member
      const [other] = await db
        .select({
          userId: conversationMembersTable.userId,
          username: usersTable.username,
          avatar: usersTable.avatar,
          role: usersTable.role,
        })
        .from(conversationMembersTable)
        .innerJoin(usersTable, eq(conversationMembersTable.userId, usersTable.id))
        .where(and(
          eq(conversationMembersTable.conversationId, convId),
          ne(conversationMembersTable.userId, userId),
        ))
        .limit(1);

      // Last message
      const [lastMsg] = await db
        .select({ content: directMessagesTable.content, messageType: directMessagesTable.messageType, createdAt: directMessagesTable.createdAt, senderId: directMessagesTable.senderId })
        .from(directMessagesTable)
        .where(and(
          eq(directMessagesTable.conversationId, convId),
          eq(directMessagesTable.isDeletedAll, false),
        ))
        .orderBy(desc(directMessagesTable.createdAt))
        .limit(1);

      // Unread count
      const lastRead = await db.select().from(dmReadsTable)
        .where(and(eq(dmReadsTable.conversationId, convId), eq(dmReadsTable.userId, userId)))
        .limit(1);

      let unread = 0;
      if (lastRead[0]) {
        const [result] = await db
          .select({ count: sql<number>`cast(count(*) as int)` })
          .from(directMessagesTable)
          .where(and(
            eq(directMessagesTable.conversationId, convId),
            eq(directMessagesTable.isDeletedAll, false),
            ne(directMessagesTable.senderId, userId),
            gt(directMessagesTable.createdAt, lastRead[0].lastReadAt),
          ));
        unread = result?.count ?? 0;
      } else {
        const [result] = await db
          .select({ count: sql<number>`cast(count(*) as int)` })
          .from(directMessagesTable)
          .where(and(
            eq(directMessagesTable.conversationId, convId),
            eq(directMessagesTable.isDeletedAll, false),
            ne(directMessagesTable.senderId, userId),
          ));
        unread = result?.count ?? 0;
      }

      return {
        conversationId: convId,
        isPinned: membership.isPinned,
        isArchived: membership.isArchived,
        isFavorite: membership.isFavorite,
        isMuted: membership.isMuted,
        otherUser: other ?? null,
        lastMessage: lastMsg ?? null,
        unread,
      };
    }));

    // Sort: pinned first, then by last message time
    const sorted = convs
      .filter((c: any) => !c.isArchived)
      .sort((a: any, b: any) => {
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
        const ta = a.lastMessage?.createdAt?.getTime() ?? 0;
        const tb = b.lastMessage?.createdAt?.getTime() ?? 0;
        return tb - ta;
      });

    res.json(sorted);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Start or get DM conversation with a user ──────────────────────────────────

router.post("/dm/conversations/start", authenticate, async (req, res) => {
  try {
    const { targetUserId } = req.body;
    if (!targetUserId || !UUID_RE.test(targetUserId)) {
      res.status(400).json({ error: "targetUserId required" });
      return;
    }

    const userId = req.user!.userId;
    if (targetUserId === userId) {
      res.status(400).json({ error: "Cannot DM yourself" });
      return;
    }

    const [target] = await db.select({ id: usersTable.id, username: usersTable.username })
      .from(usersTable).where(eq(usersTable.id, targetUserId));
    if (!target) { res.status(404).json({ error: "User not found" }); return; }

    const convId = await getOrCreateConversation(userId, targetUserId);
    res.json({ conversationId: convId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Get messages in a conversation ────────────────────────────────────────────

router.get("/dm/conversations/:id/messages", authenticate, async (req, res) => {
  try {
    const convId = req.params.id;
    const userId = req.user!.userId;
    const limit = Math.min(50, parseInt(String(req.query.limit ?? "30")));
    const before = req.query.before as string | undefined;

    // Auth check
    const [membership] = await db.select().from(conversationMembersTable)
      .where(and(eq(conversationMembersTable.conversationId, convId), eq(conversationMembersTable.userId, userId)));
    if (!membership) { res.status(403).json({ error: "Not a member" }); return; }

    const conditions = [
      eq(directMessagesTable.conversationId, convId),
      eq(directMessagesTable.isDeletedAll, false),
    ];
    if (before) conditions.push(lt(directMessagesTable.createdAt, new Date(before)));

    const messages = await db
      .select({
        id: directMessagesTable.id,
        conversationId: directMessagesTable.conversationId,
        content: directMessagesTable.content,
        messageType: directMessagesTable.messageType,
        fileUrl: directMessagesTable.fileUrl,
        fileName: directMessagesTable.fileName,
        replyToId: directMessagesTable.replyToId,
        isDeletedSender: directMessagesTable.isDeletedSender,
        editedAt: directMessagesTable.editedAt,
        createdAt: directMessagesTable.createdAt,
        senderId: directMessagesTable.senderId,
        senderUsername: usersTable.username,
        senderAvatar: usersTable.avatar,
      })
      .from(directMessagesTable)
      .innerJoin(usersTable, eq(directMessagesTable.senderId, usersTable.id))
      .where(and(...conditions))
      .orderBy(desc(directMessagesTable.createdAt))
      .limit(limit);

    // Reactions
    const msgIds = messages.map((m: any) => m.id);
    let reactions: any[] = [];
    if (msgIds.length > 0) {
      reactions = await db
        .select({ messageId: dmReactionsTable.messageId, emoji: dmReactionsTable.emoji, count: sql<number>`cast(count(*) as int)` })
        .from(dmReactionsTable)
        .where(inArray(dmReactionsTable.messageId, msgIds))
        .groupBy(dmReactionsTable.messageId, dmReactionsTable.emoji);
    }

    const enriched = messages.map((m: any) => ({
      ...m,
      // Hide content for sender-deleted messages
      content: m.isDeletedSender && m.senderId === userId ? "[Pesan dihapus]" : m.content,
      reactions: reactions.filter((r: any) => r.messageId === m.id),
      isMine: m.senderId === userId,
    }));

    res.json(enriched.reverse());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Send DM ───────────────────────────────────────────────────────────────────

router.post("/dm/conversations/:id/messages", authenticate, async (req, res) => {
  try {
    const convId = req.params.id;
    const userId = req.user!.userId;

    const [membership] = await db.select().from(conversationMembersTable)
      .where(and(eq(conversationMembersTable.conversationId, convId), eq(conversationMembersTable.userId, userId)));
    if (!membership) { res.status(403).json({ error: "Not a member" }); return; }

    const { content, messageType, fileUrl, fileName, replyToId } = req.body;
    if (!content?.trim() && !fileUrl) {
      res.status(400).json({ error: "content or fileUrl required" });
      return;
    }

    const [created] = await db.insert(directMessagesTable).values({
      conversationId: convId,
      senderId: userId,
      content: content?.trim() ?? "",
      messageType: messageType ?? "text",
      fileUrl: fileUrl || null,
      fileName: fileName || null,
      replyToId: (replyToId && UUID_RE.test(replyToId)) ? replyToId : null,
    }).returning();

    // Update conversation updatedAt
    await db.update(conversationsTable).set({ updatedAt: new Date() })
      .where(eq(conversationsTable.id, convId));

    const [sender] = await db.select({ username: usersTable.username, avatar: usersTable.avatar })
      .from(usersTable).where(eq(usersTable.id, userId));

    res.status(201).json({ ...created, senderUsername: sender.username, senderAvatar: sender.avatar, isMine: true, reactions: [] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Edit DM ───────────────────────────────────────────────────────────────────

router.patch("/dm/messages/:msgId", authenticate, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) { res.status(400).json({ error: "content required" }); return; }

    const userId = req.user!.userId;
    const [msg] = await db.select().from(directMessagesTable).where(eq(directMessagesTable.id, req.params.msgId));
    if (!msg) { res.status(404).json({ error: "Not found" }); return; }
    if (msg.senderId !== userId) { res.status(403).json({ error: "Forbidden" }); return; }

    const [updated] = await db.update(directMessagesTable)
      .set({ content: content.trim(), editedAt: new Date() })
      .where(eq(directMessagesTable.id, req.params.msgId))
      .returning();
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Delete DM ─────────────────────────────────────────────────────────────────

router.delete("/dm/messages/:msgId", authenticate, async (req, res) => {
  try {
    const { deleteFor } = req.body; // "me" | "everyone"
    const userId = req.user!.userId;

    const [msg] = await db.select().from(directMessagesTable).where(eq(directMessagesTable.id, req.params.msgId));
    if (!msg) { res.status(404).json({ error: "Not found" }); return; }
    if (msg.senderId !== userId) { res.status(403).json({ error: "Forbidden" }); return; }

    if (deleteFor === "everyone") {
      await db.update(directMessagesTable)
        .set({ isDeletedAll: true, content: "[Pesan dihapus]" })
        .where(eq(directMessagesTable.id, req.params.msgId));
    } else {
      await db.update(directMessagesTable)
        .set({ isDeletedSender: true })
        .where(eq(directMessagesTable.id, req.params.msgId));
    }

    res.json({ message: "Deleted" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── React to DM ───────────────────────────────────────────────────────────────

router.post("/dm/messages/:msgId/react", authenticate, async (req, res) => {
  try {
    const { emoji } = req.body;
    if (!emoji) { res.status(400).json({ error: "emoji required" }); return; }

    const userId = req.user!.userId;
    const messageId = req.params.msgId;

    const existing = await db.select().from(dmReactionsTable)
      .where(and(eq(dmReactionsTable.messageId, messageId), eq(dmReactionsTable.userId, userId), eq(dmReactionsTable.emoji, emoji)))
      .limit(1);

    if (existing.length > 0) {
      await db.delete(dmReactionsTable).where(and(
        eq(dmReactionsTable.messageId, messageId), eq(dmReactionsTable.userId, userId), eq(dmReactionsTable.emoji, emoji),
      ));
      res.json({ toggled: false });
    } else {
      await db.insert(dmReactionsTable).values({ messageId, userId, emoji });
      res.json({ toggled: true });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Mark conversation as read ─────────────────────────────────────────────────

router.post("/dm/conversations/:id/read", authenticate, async (req, res) => {
  try {
    const convId = req.params.id;
    const userId = req.user!.userId;

    await db.insert(dmReadsTable).values({ conversationId: convId, userId, lastReadAt: new Date() })
      .onConflictDoUpdate({
        target: [dmReadsTable.conversationId, dmReadsTable.userId],
        set: { lastReadAt: new Date() },
      });

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Update conversation settings ──────────────────────────────────────────────

router.patch("/dm/conversations/:id/settings", authenticate, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const { isPinned, isArchived, isFavorite, isMuted, isBlocked } = req.body;

    const updates: Record<string, any> = {};
    if (isPinned !== undefined) updates.isPinned = !!isPinned;
    if (isArchived !== undefined) updates.isArchived = !!isArchived;
    if (isFavorite !== undefined) updates.isFavorite = !!isFavorite;
    if (isMuted !== undefined) updates.isMuted = !!isMuted;
    if (isBlocked !== undefined) updates.isBlocked = !!isBlocked;

    await db.update(conversationMembersTable)
      .set(updates)
      .where(and(
        eq(conversationMembersTable.conversationId, req.params.id),
        eq(conversationMembersTable.userId, userId),
      ));

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Unread DM count ───────────────────────────────────────────────────────────

router.get("/dm/unread", authenticate, async (req, res) => {
  try {
    const userId = req.user!.userId;

    const memberships = await db.select().from(conversationMembersTable)
      .where(and(eq(conversationMembersTable.userId, userId), eq(conversationMembersTable.isBlocked, false)));

    const reads = await db.select().from(dmReadsTable)
      .where(eq(dmReadsTable.userId, userId));
    const readMap = Object.fromEntries(reads.map((r: any) => [r.conversationId, r.lastReadAt]));

    let total = 0;
    for (const m of memberships) {
      const lastRead = readMap[m.conversationId];
      const conditions = [
        eq(directMessagesTable.conversationId, m.conversationId),
        eq(directMessagesTable.isDeletedAll, false),
        ne(directMessagesTable.senderId, userId),
      ];
      if (lastRead) conditions.push(gt(directMessagesTable.createdAt, lastRead));

      const [result] = await db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(directMessagesTable)
        .where(and(...conditions));
      total += result?.count ?? 0;
    }

    res.json({ unread: Math.min(total, 99) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Search users (for new DM) ─────────────────────────────────────────────────

router.get("/dm/search-users", authenticate, async (req, res) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (!q || q.length < 2) { res.json([]); return; }

    const users = await db
      .select({ id: usersTable.id, username: usersTable.username, avatar: usersTable.avatar, role: usersTable.role })
      .from(usersTable)
      .where(sql`lower(${usersTable.username}) like ${"%" + q.toLowerCase() + "%"}`)
      .limit(20);

    res.json(users.filter((u: any) => u.id !== req.user!.userId));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
