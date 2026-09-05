import { Router } from "express";
import { db } from "@workspace/db";
import { notificationsTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { authenticate } from "../middlewares/auth";

const router = Router();

router.get("/notifications", authenticate, async (req, res) => {
  const userId   = req.user!.userId;
  const category = req.query.category as string | undefined;

  const conditions: any[] = [eq(notificationsTable.userId, userId)];
  if (category && category !== "all") {
    conditions.push(eq(notificationsTable.category, category));
  }

  const data = await db.select().from(notificationsTable)
    .where(and(...conditions))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(100);

  res.json(data);
});

router.get("/notifications/unread-count", authenticate, async (req, res) => {
  const userId = req.user!.userId;
  const [result] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(notificationsTable)
    .where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.isRead, false)));
  res.json({ unread: result?.count ?? 0 });
});

router.patch("/notifications/read-all", authenticate, async (req, res) => {
  const userId = req.user!.userId;
  await db.update(notificationsTable).set({ isRead: true }).where(eq(notificationsTable.userId, userId));
  res.json({ message: "All marked as read" });
});

router.patch("/notifications/:id/read", authenticate, async (req, res) => {
  const id     = req.params.id as string;
  const userId = req.user!.userId;
  const [n] = await db.update(notificationsTable)
    .set({ isRead: true })
    .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, userId)))
    .returning();
  res.json(n);
});

router.delete("/notifications/:id", authenticate, async (req, res) => {
  const id     = req.params.id as string;
  const userId = req.user!.userId;
  await db.delete(notificationsTable)
    .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, userId)));
  res.json({ ok: true });
});

export default router;
