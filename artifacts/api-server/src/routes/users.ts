import { Router } from "express";
import bcrypt from "bcrypt";
import { db } from "@workspace/db";
import {
  usersTable, userSubscriptionsTable, subscriptionsTable,
  notificationsTable,
} from "@workspace/db";
import { eq, like, and, gte, desc, ilike, or } from "drizzle-orm";
import { authenticate, requireRole } from "../middlewares/auth";
import { getActiveSubscription, formatUser } from "./auth";

const router = Router();

// List users (owner/admin)
router.get("/users", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const { search, role, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = parseInt(page) || 1;
  const limitNum = Math.min(parseInt(limit) || 20, 100);
  const offset = (pageNum - 1) * limitNum;

  let query = db.select().from(usersTable);
  const conditions: any[] = [];
  if (search) conditions.push(or(ilike(usersTable.username, `%${search}%`), ilike(usersTable.email, `%${search}%`)));
  if (role) conditions.push(eq(usersTable.role, role as any));

  const all = await (conditions.length > 0 ? db.select().from(usersTable).where(and(...conditions)) : db.select().from(usersTable));
  const data = await (conditions.length > 0
    ? db.select().from(usersTable).where(and(...conditions)).orderBy(desc(usersTable.createdAt)).limit(limitNum).offset(offset)
    : db.select().from(usersTable).orderBy(desc(usersTable.createdAt)).limit(limitNum).offset(offset));

  const usersWithSubs = await Promise.all(data.map(async (u) => {
    const sub = await getActiveSubscription(u.id);
    return formatUser(u, sub);
  }));

  res.json({ data: usersWithSubs, total: all.length, page: pageNum, limit: limitNum });
});

// Get user by id
router.get("/users/:id", authenticate, async (req, res) => {
  const id = parseInt(req.params.id);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
  if (!user) { res.status(404).json({ error: "Not found" }); return; }
  const sub = await getActiveSubscription(user.id);
  res.json(formatUser(user, sub));
});

// Update user (self or owner)
router.patch("/users/:id", authenticate, async (req, res) => {
  const id = parseInt(req.params.id);
  if (req.user!.userId !== id && req.user!.role !== "owner") {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const { username, avatar, currentPassword, newPassword } = req.body;
  const updates: Partial<typeof usersTable.$inferInsert> = {};
  if (username) updates.username = username;
  if (avatar !== undefined) updates.avatar = avatar;
  if (newPassword) {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
    if (!user) { res.status(404).json({ error: "Not found" }); return; }
    const valid = await bcrypt.compare(currentPassword || "", user.passwordHash);
    if (!valid) { res.status(400).json({ error: "Wrong current password" }); return; }
    updates.passwordHash = await bcrypt.hash(newPassword, 10);
  }
  updates.updatedAt = new Date();
  const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.id, id)).returning();
  const sub = await getActiveSubscription(id);
  res.json(formatUser(updated, sub));
});

// Delete user (owner)
router.delete("/users/:id", authenticate, requireRole("owner"), async (req, res) => {
  const id = parseInt(req.params.id);
  await db.delete(usersTable).where(eq(usersTable.id, id));
  res.json({ message: "Deleted" });
});

// Change role (owner)
router.patch("/users/:id/role", authenticate, requireRole("owner"), async (req, res) => {
  const id = parseInt(req.params.id);
  const { role } = req.body;
  const [updated] = await db.update(usersTable).set({ role, updatedAt: new Date() }).where(eq(usersTable.id, id)).returning();
  const sub = await getActiveSubscription(id);
  res.json(formatUser(updated, sub));
});

// Adjust wallet (owner)
router.patch("/users/:id/wallet", authenticate, requireRole("owner"), async (req, res) => {
  const id = parseInt(req.params.id);
  const { amount, reason } = req.body;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
  if (!user) { res.status(404).json({ error: "Not found" }); return; }
  const newBalance = user.walletBalance + amount;
  const [updated] = await db.update(usersTable).set({
    walletBalance: newBalance,
    totalTopup: amount > 0 ? user.totalTopup + amount : user.totalTopup,
    updatedAt: new Date(),
  }).where(eq(usersTable.id, id)).returning();
  res.json({ userId: id, balance: updated.walletBalance, totalTopup: updated.totalTopup, totalSpent: updated.totalSpent });
});

// Ban/unban user (owner)
router.post("/users/:id/ban", authenticate, requireRole("owner"), async (req, res) => {
  const id = parseInt(req.params.id);
  const { banned } = req.body;
  const [updated] = await db.update(usersTable).set({ isBanned: banned, updatedAt: new Date() }).where(eq(usersTable.id, id)).returning();
  const sub = await getActiveSubscription(id);
  res.json(formatUser(updated, sub));
});

// Grant subscription (owner)
router.post("/users/:id/grant-subscription", authenticate, requireRole("owner"), async (req, res) => {
  const id = parseInt(req.params.id);
  const { subscriptionId, durationDays } = req.body;
  const [plan] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.id, subscriptionId)).limit(1);
  if (!plan) { res.status(404).json({ error: "Subscription plan not found" }); return; }
  const days = durationDays || plan.durationDays;
  const startDate = new Date();
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + days);

  // Deactivate existing
  await db.update(userSubscriptionsTable).set({ isActive: false }).where(eq(userSubscriptionsTable.userId, id));

  const [sub] = await db.insert(userSubscriptionsTable).values({
    userId: id, subscriptionId, startDate, endDate, isActive: true,
  }).returning();

  // Notify
  await db.insert(notificationsTable).values({
    userId: id, title: "Subscription Granted",
    message: `Your ${plan.name} subscription has been granted by admin.`,
    type: "subscription",
  });

  res.json({ ...sub, subscription: plan });
});

export default router;
