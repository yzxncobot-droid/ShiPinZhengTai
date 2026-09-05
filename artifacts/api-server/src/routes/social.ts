import { Router } from "express";
import { db } from "@workspace/db";
import {
  followersTable, blockedUsersTable, userPresenceTable, notificationsTable,
  usersTable,
} from "@workspace/db";
import { eq, and, sql, ne, desc } from "drizzle-orm";
import { authenticate } from "../middlewares/auth";

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Helper: upsert presence ───────────────────────────────────────────────────

export async function updatePresence(userId: string, status: "online" | "offline" = "online") {
  try {
    await db.insert(userPresenceTable)
      .values({ userId, status, lastSeenAt: new Date(), updatedAt: new Date() })
      .onConflictDoUpdate({
        target: userPresenceTable.userId,
        set: { status, lastSeenAt: new Date(), updatedAt: new Date() },
      });
  } catch { /* best-effort */ }
}

// ─── Presence heartbeat ────────────────────────────────────────────────────────

router.post("/social/presence", authenticate, async (req, res) => {
  await updatePresence(req.user!.userId, "online");
  res.json({ ok: true });
});

router.delete("/social/presence", authenticate, async (req, res) => {
  await updatePresence(req.user!.userId, "offline");
  res.json({ ok: true });
});

// ─── Follow / Unfollow ─────────────────────────────────────────────────────────

router.post("/social/follow/:userId", authenticate, async (req, res) => {
  const followerId  = req.user!.userId;
  const followingId = req.params.userId as string;

  if (!UUID_RE.test(followingId)) { res.status(400).json({ error: "Invalid userId" }); return; }
  if (followerId === followingId) { res.status(400).json({ error: "Cannot follow yourself" }); return; }

  // Check target exists
  const [target] = await db.select({ id: usersTable.id, username: usersTable.username, avatar: usersTable.avatar })
    .from(usersTable).where(eq(usersTable.id, followingId));
  if (!target) { res.status(404).json({ error: "User not found" }); return; }

  // Check not blocked
  const [blocked] = await db.select({ id: blockedUsersTable.id }).from(blockedUsersTable)
    .where(and(eq(blockedUsersTable.blockerId, followingId), eq(blockedUsersTable.blockedId, followerId)));
  if (blocked) { res.status(403).json({ error: "Cannot follow this user" }); return; }

  // Insert follow (upsert — idempotent)
  await db.insert(followersTable).values({ followerId, followingId }).onConflictDoNothing();

  // Notification for the followed user
  const [me] = await db.select({ username: usersTable.username, avatar: usersTable.avatar })
    .from(usersTable).where(eq(usersTable.id, followerId));
  try {
    await db.insert(notificationsTable).values({
      userId:        followingId,
      title:         `${me?.username ?? "Seseorang"} mulai mengikuti kamu`,
      message:       `${me?.username ?? "Seseorang"} sekarang mengikuti akun kamu.`,
      type:          "info",
      category:      "social",
      actorId:       followerId,
      actorUsername: me?.username ?? null,
      actorAvatar:   me?.avatar ?? null,
      referenceType: "follow",
      referenceId:   followerId,
      actionUrl:     `/user/${me?.username}`,
    });
  } catch { /* best-effort */ }

  // Counts
  const [fwrCount] = await db.select({ count: sql<number>`cast(count(*) as int)` })
    .from(followersTable).where(eq(followersTable.followingId, followingId));
  const [fwingCount] = await db.select({ count: sql<number>`cast(count(*) as int)` })
    .from(followersTable).where(eq(followersTable.followerId, followingId));

  res.status(201).json({
    following: true,
    followerCount:  fwrCount?.count ?? 0,
    followingCount: fwingCount?.count ?? 0,
  });
});

router.delete("/social/follow/:userId", authenticate, async (req, res) => {
  const followerId  = req.user!.userId;
  const followingId = req.params.userId as string;

  if (!UUID_RE.test(followingId)) { res.status(400).json({ error: "Invalid userId" }); return; }

  await db.delete(followersTable)
    .where(and(eq(followersTable.followerId, followerId), eq(followersTable.followingId, followingId)));

  const [fwrCount] = await db.select({ count: sql<number>`cast(count(*) as int)` })
    .from(followersTable).where(eq(followersTable.followingId, followingId));
  const [fwingCount] = await db.select({ count: sql<number>`cast(count(*) as int)` })
    .from(followersTable).where(eq(followersTable.followerId, followingId));

  res.json({
    following: false,
    followerCount:  fwrCount?.count ?? 0,
    followingCount: fwingCount?.count ?? 0,
  });
});

// ─── Social stats ──────────────────────────────────────────────────────────────

router.get("/social/stats/:userId", authenticate, async (req, res) => {
  const { userId  } = req.params as { userId: string };
  const me = req.user!.userId;

  const [followerCount]  = await db.select({ count: sql<number>`cast(count(*) as int)` })
    .from(followersTable).where(eq(followersTable.followingId, userId));
  const [followingCount] = await db.select({ count: sql<number>`cast(count(*) as int)` })
    .from(followersTable).where(eq(followersTable.followerId, userId));
  const [isFollowingRow] = me !== userId ? await db.select({ id: followersTable.id })
    .from(followersTable)
    .where(and(eq(followersTable.followerId, me), eq(followersTable.followingId, userId)))
    : [undefined];

  res.json({
    followerCount:  followerCount?.count  ?? 0,
    followingCount: followingCount?.count ?? 0,
    isFollowing:    !!isFollowingRow,
  });
});

// ─── Followers / Following lists ───────────────────────────────────────────────

router.get("/social/followers/:userId", authenticate, async (req, res) => {
  const list = await db
    .select({
      id: usersTable.id, username: usersTable.username,
      avatar: usersTable.avatar, role: usersTable.role,
      createdAt: followersTable.createdAt,
    })
    .from(followersTable)
    .innerJoin(usersTable, eq(followersTable.followerId, usersTable.id))
    .where(eq(followersTable.followingId, req.params.userId as string))
    .orderBy(desc(followersTable.createdAt))
    .limit(100);
  res.json(list);
});

router.get("/social/following/:userId", authenticate, async (req, res) => {
  const list = await db
    .select({
      id: usersTable.id, username: usersTable.username,
      avatar: usersTable.avatar, role: usersTable.role,
      createdAt: followersTable.createdAt,
    })
    .from(followersTable)
    .innerJoin(usersTable, eq(followersTable.followingId, usersTable.id))
    .where(eq(followersTable.followerId, req.params.userId as string))
    .orderBy(desc(followersTable.createdAt))
    .limit(100);
  res.json(list);
});

// ─── Public user profile ────────────────────────────────────────────────────────

router.get("/users/profile/:username", authenticate, async (req, res) => {
  const [user] = await db
    .select({
      id: usersTable.id, username: usersTable.username, avatar: usersTable.avatar,
      role: usersTable.role, bio: usersTable.bio, banner: usersTable.banner,
      displayName: usersTable.displayName, verificationBadge: usersTable.verificationBadge,
      creatorBadge: usersTable.creatorBadge, verifiedCreator: usersTable.verifiedCreator,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .where(and(eq(usersTable.username, req.params.username as string), eq(usersTable.isBanned, false)))
    .limit(1);

  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const me = req.user!.userId;

  const [followerCount]  = await db.select({ count: sql<number>`cast(count(*) as int)` })
    .from(followersTable).where(eq(followersTable.followingId, user.id));
  const [followingCount] = await db.select({ count: sql<number>`cast(count(*) as int)` })
    .from(followersTable).where(eq(followersTable.followerId, user.id));
  const [isFollowingRow] = me !== user.id ? await db.select({ id: followersTable.id })
    .from(followersTable)
    .where(and(eq(followersTable.followerId, me), eq(followersTable.followingId, user.id)))
    : [undefined];
  const [isBlockedRow] = await db.select({ id: blockedUsersTable.id })
    .from(blockedUsersTable)
    .where(and(eq(blockedUsersTable.blockerId, me), eq(blockedUsersTable.blockedId, user.id)));

  // Presence
  const [presence] = await db.select().from(userPresenceTable).where(eq(userPresenceTable.userId, user.id));
  const isOnline = presence?.status === "online" &&
    presence.lastSeenAt &&
    (Date.now() - new Date(presence.lastSeenAt).getTime()) < 5 * 60 * 1000;

  res.json({
    ...user,
    followerCount:  followerCount?.count  ?? 0,
    followingCount: followingCount?.count ?? 0,
    isFollowing:    !!isFollowingRow,
    isMe:           me === user.id,
    isBlocked:      !!isBlockedRow,
    isOnline:       isOnline ?? false,
    lastSeenAt:     presence?.lastSeenAt ?? null,
  });
});

// ─── Block / Unblock ──────────────────────────────────────────────────────────

router.post("/social/block/:userId", authenticate, async (req, res) => {
  const blockerId = req.user!.userId;
  const blockedId = req.params.userId as string;

  if (!UUID_RE.test(blockedId)) { res.status(400).json({ error: "Invalid userId" }); return; }
  if (blockerId === blockedId)  { res.status(400).json({ error: "Cannot block yourself" }); return; }

  await db.insert(blockedUsersTable).values({ blockerId, blockedId }).onConflictDoNothing();

  // Also unfollow both directions
  await db.delete(followersTable)
    .where(and(eq(followersTable.followerId, blockerId), eq(followersTable.followingId, blockedId)));
  await db.delete(followersTable)
    .where(and(eq(followersTable.followerId, blockedId), eq(followersTable.followingId, blockerId)));

  res.json({ blocked: true });
});

router.delete("/social/block/:userId", authenticate, async (req, res) => {
  const blockerId = req.user!.userId;
  const blockedId = req.params.userId as string;

  await db.delete(blockedUsersTable)
    .where(and(eq(blockedUsersTable.blockerId, blockerId), eq(blockedUsersTable.blockedId, blockedId)));

  res.json({ blocked: false });
});

router.get("/social/blocked", authenticate, async (req, res) => {
  const me = req.user!.userId;
  const list = await db
    .select({
      id: usersTable.id, username: usersTable.username, avatar: usersTable.avatar,
      blockedAt: blockedUsersTable.createdAt,
    })
    .from(blockedUsersTable)
    .innerJoin(usersTable, eq(blockedUsersTable.blockedId, usersTable.id))
    .where(eq(blockedUsersTable.blockerId, me))
    .orderBy(desc(blockedUsersTable.createdAt));
  res.json(list);
});

// ─── Search users (for @mention / new DM) ─────────────────────────────────────

router.get("/social/search-users", authenticate, async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (!q || q.length < 2) { res.json([]); return; }

  const me = req.user!.userId;
  const users = await db
    .select({ id: usersTable.id, username: usersTable.username, avatar: usersTable.avatar, role: usersTable.role })
    .from(usersTable)
    .where(and(
      sql`lower(${usersTable.username}) like ${"%" + q.toLowerCase() + "%"}`,
      eq(usersTable.isBanned, false),
    ))
    .limit(20);

  res.json(users.filter((u: any) => u.id !== me));
});

export default router;
