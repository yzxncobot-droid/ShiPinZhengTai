import { Router } from "express";
import { db } from "@workspace/db";
import {
  chatRoomsTable, chatRoomMembersTable, chatMessagesTable,
  chatReactionsTable, chatReadsTable,
} from "@workspace/db";
import { eq, desc, asc, and, sql, inArray, gt, lt, lte, ilike, or } from "drizzle-orm";
import { usersTable } from "@workspace/db";
import { authenticate, optionalAuth, requireRole } from "../middlewares/auth";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── List rooms ────────────────────────────────────────────────────────────────

router.get("/chat/rooms", optionalAuth, async (req, res) => {
  try {
    const userId = req.user?.userId;
    const slugFilter = req.query.slug as string | undefined;

    const query = db
      .select({
        id: chatRoomsTable.id,
        name: chatRoomsTable.name,
        slug: chatRoomsTable.slug,
        description: chatRoomsTable.description,
        imageUrl: chatRoomsTable.imageUrl,
        isLocked: chatRoomsTable.isLocked,
        slowModeSeconds: chatRoomsTable.slowModeSeconds,
        createdAt: chatRoomsTable.createdAt,
        memberCount: sql<number>`cast(count(distinct ${chatRoomMembersTable.userId}) as int)`,
      })
      .from(chatRoomsTable)
      .leftJoin(chatRoomMembersTable, and(
        eq(chatRoomMembersTable.roomId, chatRoomsTable.id),
        eq(chatRoomMembersTable.isBanned, false),
      ))
      .groupBy(chatRoomsTable.id)
      .orderBy(chatRoomsTable.createdAt);

    const rooms = slugFilter
      ? (await query).filter((r) => r.slug === slugFilter)
      : await query;

    // Unread counts per room for the user
    let unreadMap: Record<string, number> = {};
    if (userId) {
      const reads = await db.select().from(chatReadsTable)
        .where(eq(chatReadsTable.userId, userId));
      const readMap = Object.fromEntries(reads.map((r) => [r.roomId, r.lastReadAt]));

      const roomIds = rooms.map((r) => r.id);
      for (const roomId of roomIds) {
        const lastRead = readMap[roomId];
        if (lastRead) {
          const [res] = await db
            .select({ count: sql<number>`cast(count(*) as int)` })
            .from(chatMessagesTable)
            .where(and(
              eq(chatMessagesTable.roomId, roomId),
              eq(chatMessagesTable.isDeleted, false),
              gt(chatMessagesTable.createdAt, lastRead),
            ));
          unreadMap[roomId] = res?.count ?? 0;
        } else {
          const [res] = await db
            .select({ count: sql<number>`cast(count(*) as int)` })
            .from(chatMessagesTable)
            .where(and(eq(chatMessagesTable.roomId, roomId), eq(chatMessagesTable.isDeleted, false)));
          unreadMap[roomId] = Math.min(res?.count ?? 0, 99);
        }
      }
    }

    res.json(rooms.map((r) => ({ ...r, unread: unreadMap[r.id] ?? 0 })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Get single room ───────────────────────────────────────────────────────────

router.get("/chat/rooms/:id", optionalAuth, async (req, res) => {
  try {
    const id = req.params.id;
    const userId = req.user?.userId;

    const [room] = await db.select().from(chatRoomsTable).where(eq(chatRoomsTable.id, id));
    if (!room) { res.status(404).json({ error: "Room not found" }); return; }

    const [memberCount] = await db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(chatRoomMembersTable)
      .where(and(eq(chatRoomMembersTable.roomId, id), eq(chatRoomMembersTable.isBanned, false)));

    let membership: any = null;
    if (userId) {
      const [m] = await db.select().from(chatRoomMembersTable)
        .where(and(eq(chatRoomMembersTable.roomId, id), eq(chatRoomMembersTable.userId, userId)));
      membership = m ?? null;
    }

    res.json({ ...room, memberCount: memberCount?.count ?? 0, membership });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Create room (owner only) ──────────────────────────────────────────────────

router.post("/chat/rooms", authenticate, requireRole("owner"), async (req, res) => {
  try {
    const { name, slug, description, imageUrl, rules } = req.body;
    if (!name?.trim() || !slug?.trim()) {
      res.status(400).json({ error: "name and slug are required" });
      return;
    }

    const safeSlug = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");

    const [created] = await db.insert(chatRoomsTable).values({
      name: name.trim(),
      slug: safeSlug,
      description: description?.trim() || null,
      imageUrl: imageUrl || null,
      rules: rules?.trim() || null,
      createdBy: req.user!.userId,
    }).returning();

    // Auto-join creator
    await db.insert(chatRoomMembersTable).values({
      roomId: created.id,
      userId: req.user!.userId,
      role: "admin",
    }).onConflictDoNothing();

    res.status(201).json(created);
  } catch (err: any) {
    if (err.message?.includes("unique")) {
      res.status(409).json({ error: "Slug already exists" });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

// ── Update room (owner/admin) ─────────────────────────────────────────────────

router.patch("/chat/rooms/:id", authenticate, requireRole("admin"), async (req, res) => {
  try {
    const { name, description, imageUrl, rules, isLocked, slowModeSeconds } = req.body;
    const updates: Record<string, any> = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name.trim();
    if (description !== undefined) updates.description = description?.trim() || null;
    if (imageUrl !== undefined) updates.imageUrl = imageUrl || null;
    if (rules !== undefined) updates.rules = rules?.trim() || null;
    if (isLocked !== undefined) updates.isLocked = !!isLocked;
    if (slowModeSeconds !== undefined) updates.slowModeSeconds = Math.max(0, parseInt(slowModeSeconds) || 0);

    const [updated] = await db.update(chatRoomsTable).set(updates)
      .where(eq(chatRoomsTable.id, req.params.id)).returning();
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Delete room (owner only) ─────────────────────────────────────────────────

router.delete("/chat/rooms/:id", authenticate, requireRole("owner"), async (req, res) => {
  try {
    await db.delete(chatRoomsTable).where(eq(chatRoomsTable.id, req.params.id));
    res.json({ message: "Deleted" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Join room ─────────────────────────────────────────────────────────────────

router.post("/chat/rooms/:id/join", authenticate, async (req, res) => {
  try {
    const roomId = req.params.id;
    const userId = req.user!.userId;

    const [room] = await db.select().from(chatRoomsTable).where(eq(chatRoomsTable.id, roomId));
    if (!room) { res.status(404).json({ error: "Room not found" }); return; }
    if (room.isLocked) { res.status(403).json({ error: "Room is locked" }); return; }

    await db.insert(chatRoomMembersTable).values({ roomId, userId })
      .onConflictDoNothing();

    res.json({ message: "Joined" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Leave room ────────────────────────────────────────────────────────────────

router.post("/chat/rooms/:id/leave", authenticate, async (req, res) => {
  try {
    await db.delete(chatRoomMembersTable).where(and(
      eq(chatRoomMembersTable.roomId, req.params.id),
      eq(chatRoomMembersTable.userId, req.user!.userId),
    ));
    res.json({ message: "Left" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Messages — list (paginated, cursor-based) ─────────────────────────────────

router.get("/chat/rooms/:id/messages", optionalAuth, async (req, res) => {
  try {
    const roomId = req.params.id;
    const userId = req.user?.userId;
    const limit = Math.min(50, parseInt(String(req.query.limit ?? "30")));
    const before = req.query.before as string | undefined; // cursor (ISO timestamp)

    const conditions = [
      eq(chatMessagesTable.roomId, roomId),
      eq(chatMessagesTable.isDeleted, false),
    ];
    if (before) {
      conditions.push(lt(chatMessagesTable.createdAt, new Date(before)));
    }

    const messages = await db
      .select({
        id: chatMessagesTable.id,
        roomId: chatMessagesTable.roomId,
        content: chatMessagesTable.content,
        messageType: chatMessagesTable.messageType,
        fileUrl: chatMessagesTable.fileUrl,
        fileName: chatMessagesTable.fileName,
        replyToId: chatMessagesTable.replyToId,
        isPinned: chatMessagesTable.isPinned,
        editedAt: chatMessagesTable.editedAt,
        createdAt: chatMessagesTable.createdAt,
        authorId: chatMessagesTable.userId,
        authorUsername: usersTable.username,
        authorAvatar: usersTable.avatar,
        authorRole: usersTable.role,
        authorSubscriptionStatus: usersTable.subscriptionStatus,
        authorVerificationBadge: usersTable.verificationBadge,
      })
      .from(chatMessagesTable)
      .innerJoin(usersTable, eq(chatMessagesTable.userId, usersTable.id))
      .where(and(...conditions))
      .orderBy(desc(chatMessagesTable.createdAt))
      .limit(limit);

    // Reactions
    const msgIds = messages.map((m) => m.id);
    let reactions: any[] = [];
    if (msgIds.length > 0) {
      reactions = await db
        .select({
          messageId: chatReactionsTable.messageId,
          emoji: chatReactionsTable.emoji,
          count: sql<number>`cast(count(*) as int)`,
        })
        .from(chatReactionsTable)
        .where(inArray(chatReactionsTable.messageId, msgIds))
        .groupBy(chatReactionsTable.messageId, chatReactionsTable.emoji);
    }

    // My reactions
    let myReactions: any[] = [];
    if (userId && msgIds.length > 0) {
      myReactions = await db
        .select({ messageId: chatReactionsTable.messageId, emoji: chatReactionsTable.emoji })
        .from(chatReactionsTable)
        .where(and(
          inArray(chatReactionsTable.messageId, msgIds),
          eq(chatReactionsTable.userId, userId),
        ));
    }

    const enriched = messages.map((m) => ({
      ...m,
      reactions: reactions.filter((r) => r.messageId === m.id),
      myReactions: myReactions.filter((r) => r.messageId === m.id).map((r) => r.emoji),
    }));

    // Return oldest-first
    res.json(enriched.reverse());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Send message ─────────────────────────────────────────────────────────────

router.post("/chat/rooms/:id/messages", authenticate, async (req, res) => {
  try {
    const roomId = req.params.id;
    const userId = req.user!.userId;

    const [room] = await db.select().from(chatRoomsTable).where(eq(chatRoomsTable.id, roomId));
    if (!room) { res.status(404).json({ error: "Room not found" }); return; }
    if (room.isLocked && !["admin", "owner"].includes(req.user!.role)) {
      res.status(403).json({ error: "Room is locked" }); return;
    }

    // Auto-join if not a member
    await db.insert(chatRoomMembersTable).values({ roomId, userId })
      .onConflictDoNothing();

    // Slow mode check
    if (room.slowModeSeconds > 0 && !["admin", "owner"].includes(req.user!.role)) {
      const since = new Date(Date.now() - room.slowModeSeconds * 1000);
      const [recent] = await db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(chatMessagesTable)
        .where(and(
          eq(chatMessagesTable.roomId, roomId),
          eq(chatMessagesTable.userId, userId),
          gt(chatMessagesTable.createdAt, since),
        ));
      if ((recent?.count ?? 0) > 0) {
        res.status(429).json({ error: `Slow mode: wait ${room.slowModeSeconds}s between messages` });
        return;
      }
    }

    const { content, messageType, fileUrl, fileName, replyToId } = req.body;
    if (!content?.trim() && !fileUrl) {
      res.status(400).json({ error: "content or fileUrl required" });
      return;
    }

    const [created] = await db.insert(chatMessagesTable).values({
      roomId,
      userId,
      content: content?.trim() ?? "",
      messageType: messageType ?? "text",
      fileUrl: fileUrl || null,
      fileName: fileName || null,
      replyToId: (replyToId && UUID_RE.test(replyToId)) ? replyToId : null,
    }).returning();

    const [author] = await db
      .select({ username: usersTable.username, avatar: usersTable.avatar, role: usersTable.role, subscriptionStatus: usersTable.subscriptionStatus, verificationBadge: usersTable.verificationBadge })
      .from(usersTable).where(eq(usersTable.id, userId));

    res.status(201).json({ ...created, authorUsername: author.username, authorAvatar: author.avatar, authorRole: author.role, authorSubscriptionStatus: author.subscriptionStatus, authorVerificationBadge: author.verificationBadge ?? null, reactions: [], myReactions: [] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Edit message ──────────────────────────────────────────────────────────────

router.patch("/chat/rooms/:roomId/messages/:msgId", authenticate, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) { res.status(400).json({ error: "content required" }); return; }

    const userId = req.user!.userId;
    const [msg] = await db.select().from(chatMessagesTable).where(eq(chatMessagesTable.id, req.params.msgId));
    if (!msg) { res.status(404).json({ error: "Not found" }); return; }
    if (msg.userId !== userId) { res.status(403).json({ error: "Forbidden" }); return; }

    const [updated] = await db.update(chatMessagesTable)
      .set({ content: content.trim(), editedAt: new Date() })
      .where(eq(chatMessagesTable.id, req.params.msgId))
      .returning();
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Delete message ────────────────────────────────────────────────────────────

router.delete("/chat/rooms/:roomId/messages/:msgId", authenticate, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const role = req.user!.role;

    const [msg] = await db.select().from(chatMessagesTable).where(eq(chatMessagesTable.id, req.params.msgId));
    if (!msg) { res.status(404).json({ error: "Not found" }); return; }
    if (msg.userId !== userId && !["admin", "owner"].includes(role)) {
      res.status(403).json({ error: "Forbidden" }); return;
    }

    await db.update(chatMessagesTable)
      .set({ isDeleted: true, content: "[Pesan dihapus]" })
      .where(eq(chatMessagesTable.id, req.params.msgId));

    res.json({ message: "Deleted" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Pin message (admin/owner) ─────────────────────────────────────────────────

router.patch("/chat/rooms/:roomId/messages/:msgId/pin", authenticate, requireRole("admin"), async (req, res) => {
  try {
    const [msg] = await db.select().from(chatMessagesTable).where(eq(chatMessagesTable.id, req.params.msgId));
    if (!msg) { res.status(404).json({ error: "Not found" }); return; }

    const [updated] = await db.update(chatMessagesTable)
      .set({ isPinned: !msg.isPinned })
      .where(eq(chatMessagesTable.id, req.params.msgId))
      .returning();
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── React to message ──────────────────────────────────────────────────────────

router.post("/chat/rooms/:roomId/messages/:msgId/react", authenticate, async (req, res) => {
  try {
    const { emoji } = req.body;
    if (!emoji) { res.status(400).json({ error: "emoji required" }); return; }

    const userId = req.user!.userId;
    const messageId = req.params.msgId;

    const existing = await db.select().from(chatReactionsTable)
      .where(and(
        eq(chatReactionsTable.messageId, messageId),
        eq(chatReactionsTable.userId, userId),
        eq(chatReactionsTable.emoji, emoji),
      )).limit(1);

    if (existing.length > 0) {
      await db.delete(chatReactionsTable).where(and(
        eq(chatReactionsTable.messageId, messageId),
        eq(chatReactionsTable.userId, userId),
        eq(chatReactionsTable.emoji, emoji),
      ));
      res.json({ toggled: false });
    } else {
      await db.insert(chatReactionsTable).values({ messageId, userId, emoji });
      res.json({ toggled: true });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Mark room as read ─────────────────────────────────────────────────────────

router.post("/chat/rooms/:id/read", authenticate, async (req, res) => {
  try {
    const roomId = req.params.id;
    const userId = req.user!.userId;

    await db.insert(chatReadsTable).values({ roomId, userId, lastReadAt: new Date() })
      .onConflictDoUpdate({
        target: [chatReadsTable.roomId, chatReadsTable.userId],
        set: { lastReadAt: new Date() },
      });

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Pinned messages ───────────────────────────────────────────────────────────

router.get("/chat/rooms/:id/pinned", optionalAuth, async (req, res) => {
  try {
    const messages = await db
      .select({
        id: chatMessagesTable.id,
        content: chatMessagesTable.content,
        messageType: chatMessagesTable.messageType,
        createdAt: chatMessagesTable.createdAt,
        authorUsername: usersTable.username,
      })
      .from(chatMessagesTable)
      .innerJoin(usersTable, eq(chatMessagesTable.userId, usersTable.id))
      .where(and(
        eq(chatMessagesTable.roomId, req.params.id),
        eq(chatMessagesTable.isPinned, true),
        eq(chatMessagesTable.isDeleted, false),
      ))
      .orderBy(desc(chatMessagesTable.createdAt));

    res.json(messages);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Members ───────────────────────────────────────────────────────────────────

router.get("/chat/rooms/:id/members", optionalAuth, async (req, res) => {
  try {
    const members = await db
      .select({
        userId: chatRoomMembersTable.userId,
        role: chatRoomMembersTable.role,
        isBanned: chatRoomMembersTable.isBanned,
        isMuted: chatRoomMembersTable.isMuted,
        joinedAt: chatRoomMembersTable.joinedAt,
        username: usersTable.username,
        avatar: usersTable.avatar,
      })
      .from(chatRoomMembersTable)
      .innerJoin(usersTable, eq(chatRoomMembersTable.userId, usersTable.id))
      .where(and(
        eq(chatRoomMembersTable.roomId, req.params.id),
        eq(chatRoomMembersTable.isBanned, false),
      ))
      .orderBy(chatRoomMembersTable.joinedAt)
      .limit(100);

    res.json(members);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Moderate member (mute/ban/kick) ──────────────────────────────────────────

router.post("/chat/rooms/:id/moderate", authenticate, requireRole("admin"), async (req, res) => {
  try {
    const { targetUserId, action, muteDurationSeconds } = req.body;
    if (!targetUserId || !action) {
      res.status(400).json({ error: "targetUserId and action required" });
      return;
    }

    if (action === "ban") {
      await db.update(chatRoomMembersTable)
        .set({ isBanned: true })
        .where(and(
          eq(chatRoomMembersTable.roomId, req.params.id),
          eq(chatRoomMembersTable.userId, targetUserId),
        ));
    } else if (action === "unban") {
      await db.update(chatRoomMembersTable)
        .set({ isBanned: false })
        .where(and(
          eq(chatRoomMembersTable.roomId, req.params.id),
          eq(chatRoomMembersTable.userId, targetUserId),
        ));
    } else if (action === "mute") {
      const until = muteDurationSeconds
        ? new Date(Date.now() + muteDurationSeconds * 1000)
        : null;
      await db.update(chatRoomMembersTable)
        .set({ isMuted: true, mutedUntil: until })
        .where(and(
          eq(chatRoomMembersTable.roomId, req.params.id),
          eq(chatRoomMembersTable.userId, targetUserId),
        ));
    } else if (action === "unmute") {
      await db.update(chatRoomMembersTable)
        .set({ isMuted: false, mutedUntil: null })
        .where(and(
          eq(chatRoomMembersTable.roomId, req.params.id),
          eq(chatRoomMembersTable.userId, targetUserId),
        ));
    } else if (action === "kick") {
      await db.delete(chatRoomMembersTable).where(and(
        eq(chatRoomMembersTable.roomId, req.params.id),
        eq(chatRoomMembersTable.userId, targetUserId),
      ));
    }

    res.json({ message: `Action '${action}' applied` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Unread total ──────────────────────────────────────────────────────────────

router.get("/chat/unread", authenticate, async (req, res) => {
  try {
    const userId = req.user!.userId;

    const reads = await db.select().from(chatReadsTable)
      .where(eq(chatReadsTable.userId, userId));

    const rooms = await db.select({ id: chatRoomsTable.id }).from(chatRoomsTable);
    const readMap = Object.fromEntries(reads.map((r) => [r.roomId, r.lastReadAt]));

    let total = 0;
    for (const room of rooms) {
      const lastRead = readMap[room.id];
      const conditions = [eq(chatMessagesTable.roomId, room.id), eq(chatMessagesTable.isDeleted, false)];
      if (lastRead) conditions.push(gt(chatMessagesTable.createdAt, lastRead));

      const [result] = await db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(chatMessagesTable)
        .where(and(...conditions));
      total += Math.min(result?.count ?? 0, 99);
    }

    res.json({ unread: Math.min(total, 99) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Typing indicator ─────────────────────────────────────────────────────────
// Uses Redis with a 5-second TTL per user. Gracefully no-ops when Redis is unavailable.

router.post("/chat/rooms/:id/typing", authenticate, async (req, res) => {
  try {
    const roomId = req.params.id;
    const username = req.user!.username;
    const { redis } = await import("../lib/redis");
    if (redis) {
      await (redis as any).set(`typing:${roomId}:${username}`, "1", { ex: 5 });
    }
    res.status(204).end();
  } catch {
    res.status(204).end(); // always succeed silently
  }
});

router.get("/chat/rooms/:id/typing", optionalAuth, async (req, res) => {
  try {
    const roomId = req.params.id;
    const myUsername = req.user?.username;
    const { redis } = await import("../lib/redis");
    if (!redis) { res.json({ users: [] }); return; }
    // Scan for keys matching typing:<roomId>:*
    const keys: string[] = await (redis as any).keys(`typing:${roomId}:*`);
    const users = keys
      .map((k) => k.split(":").slice(2).join(":"))
      .filter((u) => u !== myUsername);
    res.json({ users });
  } catch {
    res.json({ users: [] });
  }
});

// ── Groups list (enhanced rooms list with latest message + unread count) ───────

router.get("/chat/groups", optionalAuth, async (req, res) => {
  try {
    const userId  = req.user?.userId;
    const search  = String(req.query.search  ?? "").trim();
    const category = String(req.query.category ?? "").trim();

    const whereConditions = [];
    if (search)   whereConditions.push(ilike(chatRoomsTable.name, `%${search}%`));
    if (category) whereConditions.push(eq(chatRoomsTable.category, category));
    const whereClause = whereConditions.length ? and(...whereConditions) : undefined;

    const rooms = await db
      .select({
        id:            chatRoomsTable.id,
        name:          chatRoomsTable.name,
        slug:          chatRoomsTable.slug,
        description:   chatRoomsTable.description,
        imageUrl:      chatRoomsTable.imageUrl,
        isLocked:      chatRoomsTable.isLocked,
        slowModeSeconds: chatRoomsTable.slowModeSeconds,
        category:      chatRoomsTable.category,
        isPinnedGroup: chatRoomsTable.isPinnedGroup,
        isPublic:      chatRoomsTable.isPublic,
        sortOrder:     chatRoomsTable.sortOrder,
        createdAt:     chatRoomsTable.createdAt,
        memberCount:   sql<number>`cast(count(distinct ${chatRoomMembersTable.userId}) filter (where ${chatRoomMembersTable.isBanned} = false) as int)`,
      })
      .from(chatRoomsTable)
      .leftJoin(chatRoomMembersTable, eq(chatRoomMembersTable.roomId, chatRoomsTable.id))
      .where(whereClause)
      .groupBy(chatRoomsTable.id)
      .orderBy(
        desc(chatRoomsTable.isPinnedGroup),
        asc(chatRoomsTable.sortOrder),
        desc(chatRoomsTable.createdAt),
      );

    if (rooms.length === 0) { res.json([]); return; }

    const roomIds = rooms.map((r) => r.id);

    // Latest message per room (one batch query, then pick latest per roomId)
    const recentMsgs = await db
      .select({
        roomId:         chatMessagesTable.roomId,
        content:        chatMessagesTable.content,
        messageType:    chatMessagesTable.messageType,
        createdAt:      chatMessagesTable.createdAt,
        authorUsername: usersTable.username,
      })
      .from(chatMessagesTable)
      .innerJoin(usersTable, eq(chatMessagesTable.userId, usersTable.id))
      .where(and(
        inArray(chatMessagesTable.roomId, roomIds),
        eq(chatMessagesTable.isDeleted, false),
      ))
      .orderBy(desc(chatMessagesTable.createdAt))
      .limit(roomIds.length * 5); // enough to get ≥1 per room

    const latestByRoom = new Map<string, typeof recentMsgs[number]>();
    for (const m of recentMsgs) {
      if (!latestByRoom.has(m.roomId)) latestByRoom.set(m.roomId, m);
    }

    // Unread count per room for authenticated user
    const unreadMap = new Map<string, number>();
    if (userId) {
      const reads = await db
        .select({ roomId: chatReadsTable.roomId, lastReadAt: chatReadsTable.lastReadAt })
        .from(chatReadsTable)
        .where(and(eq(chatReadsTable.userId, userId), inArray(chatReadsTable.roomId, roomIds)));
      const readMap = new Map<string, Date>(reads.map((r) => [r.roomId, new Date(r.lastReadAt)]));

      await Promise.all(
        roomIds.map(async (roomId) => {
          const lastRead = readMap.get(roomId) ?? new Date(0);
          const [row] = await db
            .select({ cnt: sql<number>`cast(count(*) as int)` })
            .from(chatMessagesTable)
            .where(and(
              eq(chatMessagesTable.roomId, roomId),
              eq(chatMessagesTable.isDeleted, false),
              gt(chatMessagesTable.createdAt, lastRead),
            ));
          unreadMap.set(roomId, row?.cnt ?? 0);
        }),
      );
    }

    res.json(rooms.map((r) => ({
      ...r,
      latestMessage: latestByRoom.get(r.id) ?? null,
      unreadCount:   unreadMap.get(r.id) ?? 0,
    })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: update room group settings (pin, category, public/private) ─────────

router.patch("/chat/rooms/:id/group-settings", authenticate, requireRole("owner"), async (req, res) => {
  try {
    const { category, isPinnedGroup, isPublic, sortOrder, memberLimit } = req.body;
    const updates: Record<string, any> = { updatedAt: new Date() };
    if (category     !== undefined) updates.category     = category     ?? null;
    if (isPinnedGroup !== undefined) updates.isPinnedGroup = Boolean(isPinnedGroup);
    if (isPublic     !== undefined) updates.isPublic     = Boolean(isPublic);
    if (sortOrder    !== undefined) updates.sortOrder    = Number(sortOrder);
    if (memberLimit  !== undefined) updates.memberLimit  = memberLimit ? Number(memberLimit) : null;

    const [updated] = await db.update(chatRoomsTable)
      .set(updates)
      .where(eq(chatRoomsTable.id, req.params.id))
      .returning();
    if (!updated) { res.status(404).json({ error: "Room not found" }); return; }
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

