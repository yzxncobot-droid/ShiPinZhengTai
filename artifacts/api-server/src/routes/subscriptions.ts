import { Router } from "express";
import { db } from "@workspace/db";
import {
  subscriptionsTable, userSubscriptionsTable, usersTable,
  transactionsTable, notificationsTable, walletsTable, walletTransactionsTable,
} from "@workspace/db";
import { eq, and, gte, desc, sql } from "drizzle-orm";
import { authenticate, requireRole } from "../middlewares/auth";
import { getActiveSubscription } from "./auth";
import { logger } from "../lib/logger";

const router = Router();

// ── GET /subscriptions — list all active plans (public) ──────────────────────
router.get("/subscriptions", async (_req, res) => {
  const plans = await db.select().from(subscriptionsTable)
    .where(eq(subscriptionsTable.isActive, true))
    .orderBy(subscriptionsTable.sortOrder);
  res.json(plans);
});

// ── GET /subscriptions/all — all plans including inactive (admin/owner) ───────
router.get("/subscriptions/all", authenticate, requireRole("admin", "owner"), async (_req, res) => {
  const plans = await db.select().from(subscriptionsTable).orderBy(subscriptionsTable.sortOrder);
  res.json(plans);
});

// ── POST /subscriptions — create plan (admin/owner) ──────────────────────────
router.post("/subscriptions", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const { name, description, price, durationDays, isActive = true, sortOrder = 0 } = req.body;
  if (!name || price == null || !durationDays) {
    res.status(400).json({ error: "name, price, and durationDays are required" }); return;
  }
  const [plan] = await db.insert(subscriptionsTable).values({
    name, description, price, durationDays, isActive, sortOrder,
  }).returning();
  res.status(201).json(plan);
});

// ── PATCH /subscriptions/:id (admin/owner) ────────────────────────────────────
router.patch("/subscriptions/:id", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const id = parseInt(req.params.id);
  const { name, description, price, durationDays, isActive, sortOrder } = req.body;
  const updates: any = { updatedAt: new Date() };
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (price !== undefined) updates.price = price;
  if (durationDays !== undefined) updates.durationDays = durationDays;
  if (isActive !== undefined) updates.isActive = isActive;
  if (sortOrder !== undefined) updates.sortOrder = sortOrder;
  const [updated] = await db.update(subscriptionsTable).set(updates).where(eq(subscriptionsTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

// ── DELETE /subscriptions/:id (owner) ────────────────────────────────────────
router.delete("/subscriptions/:id", authenticate, requireRole("owner"), async (req, res) => {
  const id = parseInt(req.params.id);
  await db.delete(subscriptionsTable).where(eq(subscriptionsTable.id, id));
  res.json({ message: "Deleted" });
});

// ── POST /subscriptions/:id/purchase — buy a subscription plan ────────────────
router.post("/subscriptions/:id/purchase", authenticate, async (req, res) => {
  const planId = parseInt(req.params.id);
  const userId = req.user!.userId;

  const [plan] = await db.select().from(subscriptionsTable)
    .where(and(eq(subscriptionsTable.id, planId), eq(subscriptionsTable.isActive, true))).limit(1);
  if (!plan) { res.status(404).json({ error: "Plan not found or inactive" }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  if (user.walletBalance < plan.price) {
    res.status(400).json({ error: "Insufficient wallet balance" }); return;
  }

  const startDate = new Date();
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + plan.durationDays);
  const newBalance = user.walletBalance - plan.price;

  try {
    const result = await db.transaction(async (tx) => {
      // Debit wallet
      const [debited] = await tx.update(usersTable).set({
        walletBalance: newBalance,
        totalSpent: user.totalSpent + plan.price,
        subscriptionStatus: "active",
        subscriptionExpiry: endDate,
        updatedAt: new Date(),
      }).where(eq(usersTable.id, userId)).returning();

      // Deactivate old subscription
      await tx.update(userSubscriptionsTable)
        .set({ isActive: false })
        .where(and(eq(userSubscriptionsTable.userId, userId), eq(userSubscriptionsTable.isActive, true)));

      const [sub] = await tx.insert(userSubscriptionsTable).values({
        userId, subscriptionId: planId, startDate, endDate, isActive: true, pricePaid: plan.price,
      }).returning();

      await tx.insert(transactionsTable).values({
        userId, type: "subscription", amount: -plan.price,
        description: `Purchased subscription: ${plan.name}`,
        referenceId: sub.id,
      });

      await tx.insert(notificationsTable).values({
        userId, title: "Langganan Aktif ✓",
        message: `Berhasil berlangganan ${plan.name}. Aktif hingga ${endDate.toLocaleDateString("id-ID")}.`,
        type: "subscription",
      });

      return { sub, debited };
    });

    // Sync wallet ledger
    await db.update(walletsTable).set({
      balance: newBalance,
      totalSpent: user.totalSpent + plan.price,
      lastTransactionAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(walletsTable.userId, userId));

    await db.insert(walletTransactionsTable).values({
      userId, type: "subscription", amount: -plan.price,
      balanceAfter: newBalance,
      description: `Subscription: ${plan.name}`,
      referenceType: "subscription",
      referenceId: result.sub.id,
    });

    logger.info({ userId, planId, price: plan.price }, "Subscription purchased");
    res.json({ ...result.sub, subscription: plan });
  } catch (err: any) {
    logger.error({ err, userId, planId }, "Subscription purchase failed");
    res.status(500).json({ error: "Purchase failed" });
  }
});

// ── GET /subscriptions/my — current user's subscription history ───────────────
router.get("/subscriptions/my", authenticate, async (req, res) => {
  const userId = req.user!.userId;
  const data = await db
    .select({
      id: userSubscriptionsTable.id,
      userId: userSubscriptionsTable.userId,
      startDate: userSubscriptionsTable.startDate,
      endDate: userSubscriptionsTable.endDate,
      isActive: userSubscriptionsTable.isActive,
      pricePaid: userSubscriptionsTable.pricePaid,
      createdAt: userSubscriptionsTable.createdAt,
      plan: {
        id: subscriptionsTable.id,
        name: subscriptionsTable.name,
        description: subscriptionsTable.description,
        price: subscriptionsTable.price,
        durationDays: subscriptionsTable.durationDays,
      },
    })
    .from(userSubscriptionsTable)
    .innerJoin(subscriptionsTable, eq(userSubscriptionsTable.subscriptionId, subscriptionsTable.id))
    .where(eq(userSubscriptionsTable.userId, userId))
    .orderBy(desc(userSubscriptionsTable.createdAt));

  const active = await getActiveSubscription(userId);
  res.json({ data, active });
});

export default router;
