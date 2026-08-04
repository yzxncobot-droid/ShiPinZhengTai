import { Router } from "express";
import bcrypt from "bcrypt";
import { db } from "@workspace/db";
import {
  usersTable, userSubscriptionsTable, subscriptionsTable,
  notificationsTable, walletsTable, walletTransactionsTable,
  transactionsTable, referralsTable,
} from "@workspace/db";
import { eq, and, gte, desc, ilike, or, sql, count } from "drizzle-orm";
import { authenticate, requireRole } from "../middlewares/auth";
import { getActiveSubscription, formatUser } from "./auth";
import { invalidateUserCache } from "../lib/redis";
import { logger } from "../lib/logger";

const router = Router();

const VALID_ROLES = ["user", "meril", "admin", "owner"] as const;

// ── GET /users — list all users (admin/owner) ─────────────────────────────────
router.get("/users", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const { search, role, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = parseInt(page) || 1;
  const limitNum = Math.min(parseInt(limit) || 20, 100);
  const offset = (pageNum - 1) * limitNum;

  const conditions: any[] = [];
  if (search) {
    conditions.push(
      or(
        ilike(usersTable.username, `%${search}%`),
        ilike(usersTable.email, `%${search}%`),
      ),
    );
  }
  if (role) conditions.push(eq(usersTable.role, role as any));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [countRow] = await db
    .select({ total: count() })
    .from(usersTable)
    .where(where);

  const data = await db
    .select()
    .from(usersTable)
    .where(where)
    .orderBy(desc(usersTable.createdAt))
    .limit(limitNum)
    .offset(offset);

  const usersWithSubs = await Promise.all(
    data.map(async (u: any) => {
      const sub = await getActiveSubscription(u.id);
      return formatUser(u, sub);
    }),
  );

  res.json({ data: usersWithSubs, total: Number(countRow?.total ?? 0), page: pageNum, limit: limitNum });
});

// ── GET /users/:id ────────────────────────────────────────────────────────────
router.get("/users/:id", authenticate, async (req, res) => {
  const id = req.params.id as string;
  const requesterId = req.user!.userId;
  const requesterRole = req.user!.role;

  if (requesterId !== id && requesterRole !== "admin" && requesterRole !== "owner") {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
  if (!user) { res.status(404).json({ error: "Not found" }); return; }

  const sub = await getActiveSubscription(user.id);
  res.json(formatUser(user, sub));
});

// ── PATCH /users/:id — update profile ────────────────────────────────────────
router.patch("/users/:id", authenticate, async (req, res) => {
  const id = req.params.id as string;
  const requesterId = req.user!.userId;
  const requesterRole = req.user!.role;

  if (requesterId !== id && requesterRole !== "owner") {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const { username, avatar, email, currentPassword, newPassword } = req.body;
  const updates: Partial<typeof usersTable.$inferInsert> = { updatedAt: new Date() };

  if (username !== undefined) {
    if (username.trim().length < 3) { res.status(400).json({ error: "Username minimal 3 karakter" }); return; }
    if (!/^[a-zA-Z0-9_]+$/.test(username.trim())) {
      res.status(400).json({ error: "Username hanya boleh mengandung huruf, angka, dan underscore" }); return;
    }
    const [conflict] = await db.select({ id: usersTable.id })
      .from(usersTable).where(and(ilike(usersTable.username, username.trim()), sql`id != ${id}`)).limit(1);
    if (conflict) { res.status(409).json({ error: "Username sudah digunakan" }); return; }
    updates.username = username.trim();
  }
  if (avatar !== undefined) updates.avatar = avatar;
  if (email !== undefined) updates.email = email ? email.toLowerCase().trim() : null;

  if (newPassword) {
    if (newPassword.length < 6) { res.status(400).json({ error: "Password baru minimal 6 karakter" }); return; }
    if (!currentPassword && requesterRole !== "owner") {
      res.status(400).json({ error: "Current password required" }); return;
    }
    if (currentPassword) {
      const [existing] = await db.select({ passwordHash: usersTable.passwordHash })
        .from(usersTable).where(eq(usersTable.id, id)).limit(1);
      if (!existing) { res.status(404).json({ error: "Not found" }); return; }
      const valid = await bcrypt.compare(currentPassword, existing.passwordHash);
      if (!valid) { res.status(400).json({ error: "Current password incorrect" }); return; }
    }
    updates.passwordHash = await bcrypt.hash(newPassword, 12);
  }

  const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  await invalidateUserCache(id);

  const sub = await getActiveSubscription(updated.id);
  res.json(formatUser(updated, sub));
});

// ── DELETE /users/:id (owner only) ───────────────────────────────────────────
router.delete("/users/:id", authenticate, requireRole("owner"), async (req, res) => {
  const id = req.params.id as string;
  if (id === req.user!.userId) { res.status(400).json({ error: "Cannot delete own account" }); return; }
  await db.update(usersTable).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(usersTable.id, id));
  await invalidateUserCache(id);
  res.json({ message: "Deleted" });
});

// ── PATCH /users/:id/role (owner only) ───────────────────────────────────────
router.patch("/users/:id/role", authenticate, requireRole("owner"), async (req, res) => {
  const id = req.params.id as string;
  const { role } = req.body;
  if (!VALID_ROLES.includes(role)) {
    res.status(400).json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(", ")}` }); return;
  }
  if (id === req.user!.userId && role !== "owner") {
    res.status(400).json({ error: "Cannot demote own owner role" }); return;
  }
  const [updated] = await db.update(usersTable).set({ role, updatedAt: new Date() })
    .where(eq(usersTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  await invalidateUserCache(id);
  logger.info({ targetUserId: id, newRole: role, byUserId: req.user!.userId }, "User role changed");
  res.json(formatUser(updated));
});

// ── PATCH /users/:id/wallet — manual balance adjustment (admin/owner) ─────────
router.patch("/users/:id/wallet", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const id = req.params.id as string;
  const { delta, reason } = req.body;
  if (typeof delta !== "number") {
    res.status(400).json({ error: "delta must be a number" }); return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
  if (!user) { res.status(404).json({ error: "Not found" }); return; }

  const newBalance = user.walletBalance + delta;
  if (newBalance < 0) {
    res.status(400).json({ error: "Adjustment would result in negative balance" }); return;
  }

  await db.update(usersTable).set({
    walletBalance: newBalance,
    totalTopup: delta > 0 ? user.totalTopup + delta : user.totalTopup,
    totalSpent: delta < 0 ? user.totalSpent + Math.abs(delta) : user.totalSpent,
    updatedAt: new Date(),
  }).where(eq(usersTable.id, id));

  await db.update(walletsTable).set({
    balance: newBalance,
    totalEarned: delta > 0 ? sql`${walletsTable.totalEarned} + ${delta}` : walletsTable.totalEarned,
    totalSpent: delta < 0 ? sql`${walletsTable.totalSpent} + ${Math.abs(delta)}` : walletsTable.totalSpent,
    updatedAt: new Date(),
    lastTransactionAt: new Date(),
  }).where(eq(walletsTable.userId, id));

  await db.insert(walletTransactionsTable).values({
    userId: id,
    type: "adjustment",
    amount: delta,
    balanceAfter: newBalance,
    description: reason ?? `Manual adjustment by ${req.user!.role} (${req.user!.userId})`,
    referenceType: "adjustment",
    createdBy: req.user!.userId,
  });

  await db.insert(transactionsTable).values({
    userId: id,
    type: "adjustment",
    amount: delta,
    description: reason ?? "Manual wallet adjustment",
  });

  await invalidateUserCache(id);
  logger.info({ targetUserId: id, delta, newBalance, byUserId: req.user!.userId }, "Wallet adjusted");
  res.json({ userId: id, balance: newBalance, delta });
});

// ── POST /users/:id/ban (owner only) ─────────────────────────────────────────
router.post("/users/:id/ban", authenticate, requireRole("owner"), async (req, res) => {
  const id = req.params.id as string;
  if (id === req.user!.userId) { res.status(400).json({ error: "Cannot ban own account" }); return; }
  const { banned = true } = req.body;
  const [updated] = await db.update(usersTable).set({ isBanned: !!banned, updatedAt: new Date() })
    .where(eq(usersTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  await invalidateUserCache(id);
  logger.info({ targetUserId: id, banned, byUserId: req.user!.userId }, "User ban status changed");
  res.json(formatUser(updated));
});

// ── POST /users/:id/grant-subscription (admin/owner) ─────────────────────────
router.post("/users/:id/grant-subscription", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const id = req.params.id as string;
  const { subscriptionId, days } = req.body;
  if (!subscriptionId || !days) {
    res.status(400).json({ error: "subscriptionId and days are required" }); return;
  }

  const [plan] = await db.select().from(subscriptionsTable)
    .where(eq(subscriptionsTable.id, subscriptionId)).limit(1);
  if (!plan) { res.status(404).json({ error: "Subscription plan not found" }); return; }

  const startDate = new Date();
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + Number(days));

  const [sub] = await db.insert(userSubscriptionsTable).values({
    userId: id,
    subscriptionId,
    startDate,
    endDate,
    isActive: true,
    pricePaid: 0,
  }).returning();

  await db.update(usersTable).set({
    subscriptionStatus: "active",
    subscriptionExpiry: endDate,
    updatedAt: new Date(),
  }).where(eq(usersTable.id, id));

  await db.insert(notificationsTable).values({
    userId: id,
    title: "Langganan Diberikan",
    message: `Langganan ${plan.name} telah diberikan oleh admin. Aktif hingga ${endDate.toLocaleDateString("id-ID")}.`,
    type: "subscription",
  });

  await invalidateUserCache(id);
  logger.info({ targetUserId: id, subscriptionId, days }, "Subscription granted by staff");
  res.json({ ...sub, subscription: plan });
});

// ── GET /users/:id/referrals (owner/admin or self) ────────────────────────────
router.get("/users/:id/referrals", authenticate, async (req, res) => {
  const id = req.params.id as string;
  if (req.user!.userId !== id && req.user!.role !== "admin" && req.user!.role !== "owner") {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const data = await db
    .select({
      id: referralsTable.id,
      referredId: referralsTable.referredId,
      status: referralsTable.status,
      bonusAmount: referralsTable.bonusAmount,
      bonusCredited: referralsTable.bonusCredited,
      codeUsed: referralsTable.codeUsed,
      createdAt: referralsTable.createdAt,
      referred: {
        id: usersTable.id,
        username: usersTable.username,
        createdAt: usersTable.createdAt,
      },
    })
    .from(referralsTable)
    .innerJoin(usersTable, eq(usersTable.id, referralsTable.referredId))
    .where(eq(referralsTable.referrerId, id))
    .orderBy(desc(referralsTable.createdAt));

  res.json({ data, total: data.length });
});

export default router;
