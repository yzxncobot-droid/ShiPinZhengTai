import { Router } from "express";
import { db } from "@workspace/db";
import {
  subscriptionsTable, userSubscriptionsTable, usersTable,
  transactionsTable, notificationsTable,
} from "@workspace/db";
import { eq, and, gte, desc } from "drizzle-orm";
import { authenticate, requireRole } from "../middlewares/auth";

const router = Router();

router.get("/subscriptions", async (_req, res) => {
  const plans = await db.select().from(subscriptionsTable).orderBy(subscriptionsTable.price);
  res.json(plans);
});

router.post("/subscriptions", authenticate, requireRole("owner"), async (req, res) => {
  const { name, description, price, durationDays, isActive = true } = req.body;
  const [plan] = await db.insert(subscriptionsTable).values({ name, description, price, durationDays, isActive }).returning();
  res.status(201).json(plan);
});

router.patch("/subscriptions/:id", authenticate, requireRole("owner"), async (req, res) => {
  const id = parseInt(req.params.id);
  const { name, description, price, durationDays, isActive } = req.body;
  const [plan] = await db.update(subscriptionsTable).set({ name, description, price, durationDays, isActive }).where(eq(subscriptionsTable.id, id)).returning();
  res.json(plan);
});

router.delete("/subscriptions/:id", authenticate, requireRole("owner"), async (req, res) => {
  const id = parseInt(req.params.id);
  await db.delete(subscriptionsTable).where(eq(subscriptionsTable.id, id));
  res.json({ message: "Deleted" });
});

router.post("/subscriptions/:id/purchase", authenticate, async (req, res) => {
  const planId = parseInt(req.params.id);
  const userId = req.user!.userId;
  const [plan] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.id, planId)).limit(1);
  if (!plan || !plan.isActive) { res.status(404).json({ error: "Plan not found" }); return; }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  if (user.walletBalance < plan.price) {
    res.status(400).json({ error: "Insufficient wallet balance" }); return;
  }
  // Deduct wallet
  await db.update(usersTable).set({
    walletBalance: user.walletBalance - plan.price,
    totalSpent: user.totalSpent + plan.price,
    updatedAt: new Date(),
  }).where(eq(usersTable.id, userId));
  // Deactivate existing subscriptions
  await db.update(userSubscriptionsTable).set({ isActive: false }).where(eq(userSubscriptionsTable.userId, userId));
  // Create new subscription
  const startDate = new Date();
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + plan.durationDays);
  const [sub] = await db.insert(userSubscriptionsTable).values({
    userId, subscriptionId: planId, startDate, endDate, isActive: true,
  }).returning();
  // Record transaction
  await db.insert(transactionsTable).values({
    userId, type: "subscription", amount: -plan.price,
    description: `Purchased ${plan.name} subscription`,
    referenceId: sub.id,
  });
  // Notify
  await db.insert(notificationsTable).values({
    userId, title: "Subscription Active",
    message: `You have successfully subscribed to ${plan.name}. Valid for ${plan.durationDays} days.`,
    type: "subscription",
  });
  res.json({ ...sub, subscription: plan });
});

router.get("/subscriptions/my-active", authenticate, async (req, res) => {
  const userId = req.user!.userId;
  const now = new Date();
  const [sub] = await db
    .select({
      id: userSubscriptionsTable.id,
      userId: userSubscriptionsTable.userId,
      subscriptionId: userSubscriptionsTable.subscriptionId,
      startDate: userSubscriptionsTable.startDate,
      endDate: userSubscriptionsTable.endDate,
      isActive: userSubscriptionsTable.isActive,
      subscription: {
        id: subscriptionsTable.id,
        name: subscriptionsTable.name,
        description: subscriptionsTable.description,
        price: subscriptionsTable.price,
        durationDays: subscriptionsTable.durationDays,
        isActive: subscriptionsTable.isActive,
      },
    })
    .from(userSubscriptionsTable)
    .innerJoin(subscriptionsTable, eq(userSubscriptionsTable.subscriptionId, subscriptionsTable.id))
    .where(and(eq(userSubscriptionsTable.userId, userId), eq(userSubscriptionsTable.isActive, true), gte(userSubscriptionsTable.endDate, now)))
    .limit(1);
  res.json(sub || null);
});

export default router;
