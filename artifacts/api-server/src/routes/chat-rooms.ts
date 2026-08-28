import { Router } from "express";
import { db } from "@workspace/db";
import {
  chatRoomsTable, chatRoomMembersTable, chatMessagesTable,
  chatReactionsTable, chatReadsTable,
} from "@workspace/db";
import { eq, desc, asc, and, sql, inArray, gt, lt, lte, ilike, or } from "drizzle-orm";
import { usersTable } from "@workspace/db";
import { authenticate, optionalAuth, requireRole } from "../middlewares/auth";
import { logger } from "../lib/logger";
import { getUserBadgeInfo } from "../lib/gamification";

const router = Router();

// ── Helper: batch-fetch badge/role info for chat message authors ─────────────
async function enrichWithBadgeInfo(messages: any[]): Promise<any[]> {
  const authorIds = [...new Set(messages.map((m: any) => m.authorId ?? m.userId))];
  const badgeMap: Record<string, any> = {};
  await Promise.all(
    authorIds.map(async (uid: string) => {
      try {
        badgeMap[uid] = await getUserBadgeInfo(uid);
      } catch {
        badgeMap[uid] = null;
      }
    }),
  );
  return messages.map((m: any) => ({
    ...m,
    authorBadgeInfo: badgeMap[m.authorId ?? m.userId] ?? null,
  }));
}

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
      ? (await query).filter((r: any) => r.slug === slugFilter)
      : await query;

    // Unread counts per room for the user
    let unreadMap: Record<string, number> = {};
    if (userId) {
      const reads = await db.select().from(chatReadsTable)
        .where(eq(chatReadsTable.userId, userId));
      const readMap = Object.fromEntries(reads.map((r: any) => [r.roomId, r.lastReadAt]));

      const roomIds = rooms.map((r: any) => r.id);
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

    res.json(rooms.map((r: any) => ({ ...r, unread: unreadMap[r.id] ?? 0 })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Get single room ───────────────────────────────────────────────────────────

router.get("/chat/rooms/:id", optionalAuth, async (req, res) => {
  const roomId = req.params.id as string;
  const userId = req.user?.userId ?? null;

  logger.info({ roomId, userId }, "[get-room] request");

  try {
    // Validate UUID format before querying
    if (!UUID_RE.test(roomId)) {
      logger.warn({ roomId }, "[get-room] invalid UUID format");
      res.status(400).json({ success: false, code: "INVALID_ROOM_ID", message: "Invalid room ID format." });
      return;
    }

    const [room] = await db
      .select()
      .from(chatRoomsTable)
      .where(eq(chatRoomsTable.id, roomId));

    if (!room) {
      logger.warn({ roomId }, "[get-room] room not found");
      res.status(404).json({ success: false, code: "ROOM_NOT_FOUND", message: "Room not found." });
      return;
    }

    const [memberCount] = await db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(chatRoomMembersTable)
      .where(and(eq(chatRoomMembersTable.roomId, roomId), eq(chatRoomMembersTable.isBanned, false)));

    let membership: any = null;
    if (userId) {
      const [m] = await db
        .select()
        .from(chatRoomMembersTable)
        .where(and(eq(chatRoomMembersTable.roomId, roomId), eq(chatRoomMembersTable.userId, userId)));
      membership = m ?? null;
    }

    const payload = { ...room, memberCount: memberCount?.count ?? 0, membership };
    logger.info({ roomId, userId, memberCount: payload.memberCount, hasMembership: !!membership }, "[get-room] success");
    res.json(payload);
  } catch (err: any) {
    const pgErr = err.cause ?? err;
    logger.error({ roomId, userId, code: pgErr.code, message: pgErr.message, stack: err.stack }, "[get-room] database error");
    res.status(500).json({ success: false, code: "DB_ERROR", message: "Failed to load room." });
  }
});

// ── Create room (owner only) ──────────────────────────────────────────────────

const VALID_CATEGORIES = [
  "General", "Gaming", "Minecraft", "Roblox", "Anime", "Movies",
  "Music", "Programming", "Trading", "Education", "Marketplace",
  "Technology", "Sports", "Memes", "Photography",
];

router.post("/chat/rooms", authenticate, requireRole("owner"), async (req, res) => {
  const userId = req.user!.userId;

  logger.info({ userId, body: req.body }, "[create-room] incoming request");

  try {
    // ── 1. Required-field validation ─────────────────────────────────────────
    const {
      name, slug, description, imageUrl, rules,
      category, isPinnedGroup, isPublic, sortOrder, memberLimit,
      isLocked, slowModeSeconds,
    } = req.body;

    const missingFields: string[] = [];
    if (!name?.trim())  missingFields.push("name");
    if (!userId)        missingFields.push("created_by");

    if (missingFields.length > 0) {
      res.status(400).json({
        success: false,
        code: "MISSING_REQUIRED_FIELDS",
        message: `Required fields missing: ${missingFields.join(", ")}`,
        detail: null,
        hint: "Provide all required fields: name, and ensure you are authenticated.",
      });
      return;
    }

    // ── 2. Generate / sanitise slug ──────────────────────────────────────────
    const rawSlug   = slug?.trim() || name.trim().toLowerCase().replace(/\s+/g, "-");
    const safeSlug  = rawSlug.toLowerCase().replace(/[^a-z0-9-]/g, "-");

    logger.info({ userId, safeSlug }, "[create-room] generated slug");

    // ── 3. Validate category ─────────────────────────────────────────────────
    const safeCategory = category?.trim() || null;
    if (safeCategory && !VALID_CATEGORIES.includes(safeCategory)) {
      res.status(400).json({
        success: false,
        code: "INVALID_CATEGORY",
        message: `Invalid category "${safeCategory}".`,
        detail: `Allowed values: ${VALID_CATEGORIES.join(", ")}`,
        hint: "Choose one of the predefined categories, or leave it empty.",
      });
      return;
    }

    // ── 4. Verify authenticated user exists in DB ────────────────────────────
    const [existingUser] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (!existingUser) {
      res.status(403).json({
        success: false,
        code: "USER_NOT_FOUND",
        message: "Authenticated user does not exist in the database.",
        detail: null,
        hint: "Your session may be stale. Please log in again.",
      });
      return;
    }

    // ── 5. Check slug uniqueness before INSERT ───────────────────────────────
    const [existingSlug] = await db
      .select({ id: chatRoomsTable.id })
      .from(chatRoomsTable)
      .where(eq(chatRoomsTable.slug, safeSlug))
      .limit(1);

    if (existingSlug) {
      res.status(409).json({
        success: false,
        code: "SLUG_ALREADY_EXISTS",
        message: "Room URL already exists.",
        detail: `A room with slug "${safeSlug}" already exists.`,
        hint: "Choose a different room name or slug.",
      });
      return;
    }

    // ── 6. Build and log insert payload ─────────────────────────────────────
    const insertPayload = {
      name:             name.trim(),
      slug:             safeSlug,
      description:      description?.trim() || null,
      imageUrl:         imageUrl?.trim()    || null,
      rules:            rules?.trim()       || null,
      category:         safeCategory,
      isPinnedGroup:    Boolean(isPinnedGroup ?? false),
      isPublic:         Boolean(isPublic     ?? true),
      sortOrder:        Number(sortOrder     ?? 0),
      memberLimit:      memberLimit          ? Number(memberLimit) : null,
      isLocked:         Boolean(isLocked     ?? false),
      slowModeSeconds:  Number(slowModeSeconds ?? 0),
      createdBy:        userId,
    };

    logger.info({ userId, insertPayload }, "[create-room] final insert payload");

    // ── 7. INSERT ────────────────────────────────────────────────────────────
    const [created] = await db
      .insert(chatRoomsTable)
      .values(insertPayload)
      .returning();

    // Auto-join creator as admin
    await db
      .insert(chatRoomMembersTable)
      .values({ roomId: created.id, userId, role: "admin" })
      .onConflictDoNothing();

    logger.info({ userId, roomId: created.id, slug: safeSlug }, "[create-room] room created successfully");

    res.status(201).json({ success: true, message: "Room created successfully", room: created });
  } catch (err: any) {
    // ── 8. Extract real PG error (Drizzle wraps it in err.cause) ─────────────
    const pgErr   = err.cause ?? err;
    const pgCode  = pgErr.code  ?? err.code  ?? "UNKNOWN";
    const pgMsg   = pgErr.message ?? err.message ?? "Unknown database error";
    const pgDetail = pgErr.detail ?? null;
    const pgHint   = pgErr.hint   ?? null;

    logger.error({
      userId,
      pgCode, pgMsg, pgDetail, pgHint,
      stack: err.stack,
    }, "[create-room] database error");

    // ── 9. Map well-known PG error codes to clear messages ───────────────────
    // 23505 = unique_violation
    if (pgCode === "23505") {
      res.status(409).json({
        success: false,
        code: "SLUG_ALREADY_EXISTS",
        message: "Room URL already exists.",
        detail: pgDetail,
        hint: pgHint ?? "Choose a different slug.",
      });
      return;
    }

    // 23503 = foreign_key_violation (created_by references non-existent user)
    if (pgCode === "23503") {
      res.status(400).json({
        success: false,
        code: "FOREIGN_KEY_VIOLATION",
        message: "Referenced record does not exist (e.g. user not found).",
        detail: pgDetail,
        hint: pgHint,
      });
      return;
    }

    // 23502 = not_null_violation
    if (pgCode === "23502") {
      res.status(400).json({
        success: false,
        code: "NULL_CONSTRAINT_VIOLATION",
        message: "A required column was left empty.",
        detail: pgDetail,
        hint: pgHint,
      });
      return;
    }

    // 42501 = insufficient_privilege → RLS blocked the insert
    if (pgCode === "42501") {
      res.status(403).json({
        success: false,
        code: "RLS_BLOCKED",
        message: "Row-level security policy prevented this insert. Contact the database administrator.",
        detail: pgDetail,
        hint: pgHint,
      });
      return;
    }

    // Generic fallback — never expose the SQL query text
    res.status(500).json({
      success: false,
      code: `DB_ERROR_${pgCode}`,
      message: "Failed to create room due to a database error.",
      detail: pgDetail,
      hint: pgHint,
    });
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
    const roomId = req.params.id as string;
    const userId = req.user!.userId;

    const [room] = await db.select().from(chatRoomsTable).where(eq(chatRoomsTable.id, roomId));
    if (!room) { res.status(404).json({ error: "Room not found" }); return; }
    if (room.isLocked) { res.status(403).json({ error: "Room is locked" }); return; }

    await db.insert(chatRoomMembersTable).values({ roomId, userId })
      .onConflictDoNothing();

    // ── Gamification: award join group EXP (idempotent per room) ──────────────
    import("../lib/gamification").then(({ awardExp }) =>
      awardExp(userId, "join_group", `join_${roomId}`, undefined, { roomId }).catch(() => {}),
    );

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
  const roomId = req.params.id as string;
  const userId = req.user?.userId ?? null;
  try {
    const limit = Math.min(50, parseInt(String(req.query.limit ?? "30")));
    const before = req.query.before as string | undefined; // cursor (ISO timestamp)

    logger.info({ roomId, userId, limit, before: before ?? null }, "[get-messages] request");

    if (!UUID_RE.test(roomId)) {
      res.status(400).json({ success: false, code: "INVALID_ROOM_ID", message: "Invalid room ID format." });
      return;
    }

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
    const msgIds = messages.map((m: any) => m.id);
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

    const enriched = messages.map((m: any) => ({
      ...m,
      reactions: reactions.filter((r: any) => r.messageId === m.id),
      myReactions: myReactions.filter((r: any) => r.messageId === m.id).map((r: any) => r.emoji),
    }));

    // Enrich with badge/role info for each author
    const withBadges = await enrichWithBadgeInfo(enriched);

    // Return oldest-first
    logger.info({ roomId, userId, count: withBadges.length }, "[get-messages] success");
    res.json(withBadges.reverse());
  } catch (err: any) {
    const pgErr = err.cause ?? err;
    logger.error({ roomId, userId, code: pgErr.code, message: pgErr.message, stack: err.stack }, "[get-messages] database error");
    res.status(500).json({ success: false, code: "DB_ERROR", message: "Failed to load messages." });
  }
});

// ── Send message ─────────────────────────────────────────────────────────────

router.post("/chat/rooms/:id/messages", authenticate, async (req, res) => {
  try {
    const roomId = req.params.id as string;
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

    // ── Gamification: award message EXP (idempotent per message, daily-limited) ─
    import("../lib/gamification").then(({ awardExp }) =>
      awardExp(userId, "send_message", `chat_${created.id}`, undefined, { roomId }).catch(() => {}),
    );

    // ── Enrich with badge/role info for real-time chat display ────────────────
    let authorBadgeInfo: any = null;
    try { authorBadgeInfo = await getUserBadgeInfo(userId); } catch {}

    res.status(201).json({ ...created, authorUsername: author.username, authorAvatar: author.avatar, authorRole: author.role, authorSubscriptionStatus: author.subscriptionStatus, authorVerificationBadge: author.verificationBadge ?? null, authorBadgeInfo, reactions: [], myReactions: [] });
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

// ── Pin message (admin/owner) — one pin per room ──────────────────────────────

router.patch("/chat/rooms/:roomId/messages/:msgId/pin", authenticate, requireRole("admin"), async (req, res) => {
  const roomId = req.params.roomId as string;
  const msgId  = req.params.msgId;
  const pinnerId = req.user!.userId;

  try {
    const [msg] = await db.select().from(chatMessagesTable).where(eq(chatMessagesTable.id, msgId));
    if (!msg) { res.status(404).json({ error: "Not found" }); return; }

    if (msg.isPinned) {
      // Unpin
      const [updated] = await db.update(chatMessagesTable)
        .set({ isPinned: false, pinnedBy: null, pinnedAt: null })
        .where(eq(chatMessagesTable.id, msgId))
        .returning();
      res.json({ ...updated, action: "unpinned" });
    } else {
      // Unpin any currently pinned message in this room first
      await db.update(chatMessagesTable)
        .set({ isPinned: false, pinnedBy: null, pinnedAt: null })
        .where(and(eq(chatMessagesTable.roomId, roomId), eq(chatMessagesTable.isPinned, true)));

      // Pin the new one
      const [updated] = await db.update(chatMessagesTable)
        .set({ isPinned: true, pinnedBy: pinnerId, pinnedAt: new Date() })
        .where(eq(chatMessagesTable.id, msgId))
        .returning();
      res.json({ ...updated, action: "pinned" });
    }
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
    const roomId = req.params.id as string;
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
  const roomId = req.params.id as string;
  const userId = req.user?.userId ?? null;
  logger.info({ roomId, userId }, "[get-members] request");
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
    const readMap = Object.fromEntries(reads.map((r: any) => [r.roomId, r.lastReadAt]));

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
// Uses the KV store with a 5-second TTL per user. Gracefully no-ops when KV is
// unavailable (Cloudflare KV has no key-pattern scan, so typing indicators are
// disabled when only KV is configured — the try/catch returns empty silently).

router.post("/chat/rooms/:id/typing", authenticate, async (req, res) => {
  try {
    const roomId = req.params.id as string;
    const username = (req.user as any)!.username as string;
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
    const roomId = req.params.id as string;
    const myUsername = (req.user as any)?.username as string | undefined;
    const { redis } = await import("../lib/redis");
    if (!redis) { res.json({ users: [] }); return; }
    // Scan for keys matching typing:<roomId>:*
    const keys: string[] = await (redis as any).keys(`typing:${roomId}:*`);
    const users = keys
      .map((k: any) => k.split(":").slice(2).join(":"))
      .filter((u: any) => u !== myUsername);
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

    const roomIds = rooms.map((r: any) => r.id);

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
      const readMap = new Map<string, Date>(reads.map((r: any) => [r.roomId, new Date(r.lastReadAt)]));

      await Promise.all(
        roomIds.map(async (roomId: any) => {
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

    res.json(rooms.map((r: any) => ({
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

