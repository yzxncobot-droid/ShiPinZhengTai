import { Router } from "express";
import { db } from "@workspace/db";
import { transactionsTable } from "@workspace/db";
import { eq, and, desc, count } from "drizzle-orm";
import { authenticate } from "../middlewares/auth";

const router = Router();

router.get("/transactions", authenticate, async (req, res) => {
  const userId = req.user!.userId;
  const { type, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = parseInt(page) || 1;
  const limitNum = Math.min(parseInt(limit) || 20, 100);
  const offset = (pageNum - 1) * limitNum;

  const where = type
    ? and(eq(transactionsTable.userId, userId), eq(transactionsTable.type, type as any))
    : eq(transactionsTable.userId, userId);

  const [{ total }] = await db.select({ total: count() }).from(transactionsTable).where(where);
  const data = await db.select().from(transactionsTable)
    .where(where)
    .orderBy(desc(transactionsTable.createdAt))
    .limit(limitNum)
    .offset(offset);

  res.json({ data, total: Number(total), page: pageNum, limit: limitNum });
});

export default router;
