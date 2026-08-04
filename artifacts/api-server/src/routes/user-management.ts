/**
 * User Management Routes (Owner-only)
 * - Badges: assign/remove/list
 * - Bans: ban (permanent/temp), unban
 * - Mutes: mute (duration), unmute
 * - Force logout all devices
 * - Wallet history
 * - Public profile (for any authenticated user)
 */
import { Router } from "express";
import bcrypt from "bcrypt";
import { db } from "@workspace/db";
import {
  usersTable, userBadgesTable, userBansTable, userMutesTable,
  walletTransactionsTable, walletsTable,
} from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { authenticate, requireRole } from "../middlewares/auth";
import { invalidateUserCache, deleteAllUserSessions } from "../lib/redis";
import { logger } from "../lib/logger";

const router = Router();

// ── GET /users/:id/public — public profile (any authenticated user) ────────────
router.get("/users/:id/public", authenticate, async (req, res) => {
  const id = req.params.id as string;
  try {
    const [user] = await db.select({
      id: usersTable.id,
      username: usersTable.username,
      displayName: usersTable.displayName,
      bio: usersTable.bio,
      banner: usersTable.banner,
      avatar: usersTable.avatar,
      role: usersTable.role,
      verificationBadge: usersTable.verificationBadge,
      subscriptionStatus: usersTable.subscriptionStatus,
      createdAt: usersTable.createdAt,
      isBanned: usersTable.isBanned,
    }).from(usersTable).where(eq(usersTable.id, id)).limit(1);

    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    // Fetch badges
    const badges = await db.select().from(userBadgesTable).where(eq(userBadgesTable.userId, id));

    // Active ban info (for owner/admin only)
    let banInfo = null;
    if (["admin", "owner"].includes(req.user!.role)) {
      const [ban] = await db.select().from(userBansTable)
        .where(and(eq(userBansTable.userId, id), eq(userBansTable.isActive, true)))
        .orderBy(desc(userBansTable.createdAt)).limit(1);
      banInfo = ban ?? null;
    }

    // Active mute info (for owner/admin only)
    let muteInfo = null;
    if (["admin", "owner"].includes(req.user!.role)) {
      const [mute] = await db.select().from(userMutesTable)
        .where(and(eq(userMutesTable.userId, id), eq(userMutesTable.isActive, true)))
        .orderBy(desc(userMutesTable.createdAt)).limit(1);
      muteInfo = mute ?? null;
    }

    // Wallet balance for owner
    let walletBalance = null;
    if (req.user!.role === "owner") {
      walletBalance = user; // owner gets everything
    }

    res.json({
      ...user,
      badges,
      activeBan: banInfo,
      activeMute: muteInfo,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /users/:id/badges ─────────────────────────────────────────────────────
router.get("/users/:id/badges", authenticate, async (req, res) => {
  try {
    const badges = await db.select().from(userBadgesTable)
      .where(eq(userBadgesTable.userId, req.params.id))
      .orderBy(desc(userBadgesTable.assignedAt));
    res.json(badges);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /users/:id/badges — assign badge (owner only) ────────────────────────
router.post("/users/:id/badges", authenticate, requireRole("owner"), async (req, res) => {
  const targetId = req.params.id as string;
  const { badge, label, color, icon } = req.body;
  const VALID_BADGES = [
    "verified", "developer", "staff", "owner", "admin", "moderator",
    "creator", "vip", "premium", "official", "early_supporter", "beta_tester", "custom",
  ];

  if (!badge || !VALID_BADGES.includes(badge)) {
    res.status(400).json({ error: `Invalid badge. Valid: ${VALID_BADGES.join(", ")}` }); return;
  }

  try {
    const [inserted] = await db.insert(userBadgesTable).values({
      userId: targetId,
      badge,
      label: label ?? null,
      color: color ?? null,
      icon:  icon  ?? null,
      assignedBy: req.user!.userId,
    }).returning();

    logger.info({ targetId, badge, by: req.user!.userId }, "Badge assigned");
    res.status(201).json(inserted);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /users/:id/badges/:badgeId — remove badge (owner only) ─────────────
router.delete("/users/:id/badges/:badgeId", authenticate, requireRole("owner"), async (req, res) => {
  try {
    await db.delete(userBadgesTable).where(
      and(eq(userBadgesTable.id, req.params.badgeId), eq(userBadgesTable.userId, req.params.id)),
    );
    logger.info({ badgeId: req.params.badgeId, targetId: req.params.id, by: req.user!.userId }, "Badge removed");
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /users/:id/ban-detail — ban with reason/type/expiry (owner only) ─────
router.post("/users/:id/ban-detail", authenticate, requireRole("owner"), async (req, res) => {
  const targetId = req.params.id as string;
  if (targetId === req.user!.userId) {
    res.status(400).json({ error: "Cannot ban own account" }); return;
  }

  const { banType = "permanent", reason, expiresAt } = req.body;
  if (!["permanent", "temporary"].includes(banType)) {
    res.status(400).json({ error: "banType must be 'permanent' or 'temporary'" }); return;
  }
  if (banType === "temporary" && !expiresAt) {
    res.status(400).json({ error: "expiresAt required for temporary ban" }); return;
  }

  try {
    // Deactivate any existing active ban
    await db.update(userBansTable).set({ isActive: false, revokedAt: new Date(), revokedBy: req.user!.userId })
      .where(and(eq(userBansTable.userId, targetId), eq(userBansTable.isActive, true)));

    const [ban] = await db.insert(userBansTable).values({
      userId: targetId,
      banType,
      reason: reason ?? null,
      expiresAt: banType === "temporary" ? new Date(expiresAt) : null,
      bannedBy: req.user!.userId,
      isActive: true,
    }).returning();

    // Update users.is_banned fast flag
    await db.update(usersTable).set({ isBanned: true, updatedAt: new Date() })
      .where(eq(usersTable.id, targetId));
    await invalidateUserCache(targetId);

    // Force logout
    await deleteAllUserSessions(targetId).catch(() => {});
    logger.info({ targetId, banType, reason, by: req.user!.userId }, "User banned");
    res.json(ban);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /users/:id/unban (owner only) ────────────────────────────────────────
router.post("/users/:id/unban", authenticate, requireRole("owner"), async (req, res) => {
  const targetId = req.params.id as string;
  const { note } = req.body;
  try {
    await db.update(userBansTable).set({
      isActive: false, revokedAt: new Date(),
      revokedBy: req.user!.userId, revokedNote: note ?? null,
    }).where(and(eq(userBansTable.userId, targetId), eq(userBansTable.isActive, true)));

    await db.update(usersTable).set({ isBanned: false, updatedAt: new Date() })
      .where(eq(usersTable.id, targetId));
    await invalidateUserCache(targetId);

    logger.info({ targetId, by: req.user!.userId }, "User unbanned");
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /users/:id/mute (owner only) ─────────────────────────────────────────
router.post("/users/:id/mute", authenticate, requireRole("owner"), async (req, res) => {
  const targetId = req.params.id as string;
  if (targetId === req.user!.userId) {
    res.status(400).json({ error: "Cannot mute own account" }); return;
  }

  const { durationSeconds, reason } = req.body;
  // durationSeconds: null = permanent; number = temp
  const expiresAt = durationSeconds
    ? new Date(Date.now() + Number(durationSeconds) * 1000)
    : null;

  try {
    // Deactivate existing mutes
    await db.update(userMutesTable).set({ isActive: false, revokedAt: new Date(), revokedBy: req.user!.userId })
      .where(and(eq(userMutesTable.userId, targetId), eq(userMutesTable.isActive, true)));

    const [mute] = await db.insert(userMutesTable).values({
      userId: targetId,
      reason: reason ?? null,
      expiresAt,
      mutedBy: req.user!.userId,
      isActive: true,
    }).returning();

    logger.info({ targetId, durationSeconds, by: req.user!.userId }, "User muted");
    res.json(mute);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /users/:id/unmute (owner only) ───────────────────────────────────────
router.post("/users/:id/unmute", authenticate, requireRole("owner"), async (req, res) => {
  const targetId = req.params.id as string;
  try {
    await db.update(userMutesTable).set({ isActive: false, revokedAt: new Date(), revokedBy: req.user!.userId })
      .where(and(eq(userMutesTable.userId, targetId), eq(userMutesTable.isActive, true)));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /users/:id/force-logout (owner only) ──────────────────────────────────
router.post("/users/:id/force-logout", authenticate, requireRole("owner"), async (req, res) => {
  const targetId = req.params.id as string;
  try {
    await deleteAllUserSessions(targetId);
    await invalidateUserCache(targetId);
    logger.info({ targetId, by: req.user!.userId }, "Force logout all devices");
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /users/:id/wallet-history ─────────────────────────────────────────────
router.get("/users/:id/wallet-history", authenticate, async (req, res) => {
  const id = req.params.id as string;
  // Only owner can see others' wallet history
  if (req.user!.userId !== id && req.user!.role !== "owner") {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  try {
    const limit = Math.min(50, parseInt(String(req.query.limit ?? "20")));
    const txs = await db.select().from(walletTransactionsTable)
      .where(eq(walletTransactionsTable.userId, id))
      .orderBy(desc(walletTransactionsTable.createdAt))
      .limit(limit);

    const [wallet] = await db.select().from(walletsTable).where(eq(walletsTable.userId, id)).limit(1);
    res.json({ balance: wallet?.balance ?? 0, transactions: txs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /users/:id/wallet-set — set absolute balance (owner only) ───────────
router.patch("/users/:id/wallet-set", authenticate, requireRole("owner"), async (req, res) => {
  const id = req.params.id as string;
  const { amount, reason } = req.body;
  if (typeof amount !== "number" || amount < 0) {
    res.status(400).json({ error: "amount must be a non-negative number" }); return;
  }
  try {
    const [user] = await db.select({ walletBalance: usersTable.walletBalance })
      .from(usersTable).where(eq(usersTable.id, id)).limit(1);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    const delta = amount - user.walletBalance;
    await db.update(usersTable).set({ walletBalance: amount, updatedAt: new Date() }).where(eq(usersTable.id, id));
    await db.update(walletsTable).set({ balance: amount, updatedAt: new Date() }).where(eq(walletsTable.userId, id));
    await db.insert(walletTransactionsTable).values({
      userId: id, type: "adjustment", amount: delta, balanceAfter: amount,
      description: reason ?? `Balance set to ${amount} by owner`,
      referenceType: "adjustment", createdBy: req.user!.userId,
    });
    await invalidateUserCache(id);
    res.json({ userId: id, balance: amount });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /users/:id/reset-password — owner resets another user's password ────
router.patch("/users/:id/reset-password", authenticate, requireRole("owner"), async (req, res) => {
  const targetId = req.params.id as string;
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    res.status(400).json({ error: "newPassword must be at least 6 characters" }); return;
  }
  try {
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await db.update(usersTable).set({ passwordHash, updatedAt: new Date() }).where(eq(usersTable.id, targetId));
    // Force logout existing sessions
    await deleteAllUserSessions(targetId).catch(() => {});
    await invalidateUserCache(targetId);
    logger.info({ targetId, by: req.user!.userId }, "Password reset by owner");
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /users/:id/profile — update displayName/bio/banner (self or owner) ──
router.patch("/users/:id/profile", authenticate, async (req, res) => {
  const id = req.params.id as string;
  if (req.user!.userId !== id && req.user!.role !== "owner") {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const { displayName, bio, banner } = req.body;
  const updates: Record<string, any> = { updatedAt: new Date() };
  if (displayName !== undefined) updates.displayName = displayName?.trim() || null;
  if (bio !== undefined) updates.bio = bio?.trim() || null;
  if (banner !== undefined) updates.banner = banner || null;

  try {
    const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.id, id)).returning();
    res.json({ success: true, displayName: updated.displayName, bio: updated.bio, banner: updated.banner });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
