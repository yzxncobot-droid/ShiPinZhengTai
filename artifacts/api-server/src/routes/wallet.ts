import { Router } from "express";
import { db } from "@workspace/db";
import {
  usersTable, walletsTable, walletTransactionsTable,
  transactionsTable,
} from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";
import { authenticate } from "../middlewares/auth";
import { logger } from "../lib/logger";

const router = Router();

// ── GET /wallet — current user's wallet summary ───────────────────────────────
router.get("/wallet", authenticate, async (req, res) => {
  const userId = req.user!.userId;
  const [user] = await db.select({
    id: usersTable.id,
    walletBalance: usersTable.walletBalance,
    totalTopup: usersTable.totalTopup,
    totalSpent: usersTable.totalSpent,
    subscriptionStatus: usersTable.subscriptionStatus,
    subscriptionExpiry: usersTable.subscriptionExpiry,
  }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);

  if (!user) { res.status(404).json({ error: "Not found" }); return; }

  // Ensure a wallet row exists (idempotent)
  await db.insert(walletsTable)
    .values({ userId, balance: user.walletBalance, totalEarned: user.totalTopup, totalSpent: user.totalSpent })
    .onConflictDoNothing();

  const [wallet] = await db.select().from(walletsTable).where(eq(walletsTable.userId, userId)).limit(1);

  res.json({
    userId: user.id,
    balance: user.walletBalance,
    totalEarned: user.totalTopup,
    totalSpent: user.totalSpent,
    subscriptionStatus: user.subscriptionStatus,
    subscriptionExpiry: user.subscriptionExpiry,
    wallet: wallet ?? null,
  });
});

// ── GET /wallet/transactions — recent wallet transactions ─────────────────────
router.get("/wallet/transactions", authenticate, async (req, res) => {
  const userId = req.user!.userId;
  const { page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = parseInt(page) || 1;
  const limitNum = Math.min(parseInt(limit) || 20, 100);
  const offset = (pageNum - 1) * limitNum;

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(transactionsTable)
    .where(eq(transactionsTable.userId, userId));

  const data = await db
    .select()
    .from(transactionsTable)
    .where(eq(transactionsTable.userId, userId))
    .orderBy(desc(transactionsTable.createdAt))
    .limit(limitNum)
    .offset(offset);

  res.json({ data, total: Number(total ?? 0), page: pageNum, limit: limitNum });
});

// ── GET /wallet/ledger — full double-entry ledger ─────────────────────────────
router.get("/wallet/ledger", authenticate, async (req, res) => {
  const userId = req.user!.userId;
  const { page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = parseInt(page) || 1;
  const limitNum = Math.min(parseInt(limit) || 20, 100);
  const offset = (pageNum - 1) * limitNum;

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(walletTransactionsTable)
    .where(eq(walletTransactionsTable.userId, userId));

  const data = await db
    .select()
    .from(walletTransactionsTable)
    .where(eq(walletTransactionsTable.userId, userId))
    .orderBy(desc(walletTransactionsTable.createdAt))
    .limit(limitNum)
    .offset(offset);

  res.json({ data, total: Number(total ?? 0), page: pageNum, limit: limitNum });
});

export default router;
