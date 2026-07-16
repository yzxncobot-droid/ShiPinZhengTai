import { Router } from "express";
import { db } from "@workspace/db";
import { notificationsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { authenticate } from "../middlewares/auth";

const router = Router();

router.get("/notifications", authenticate, async (req, res) => {
  const userId = req.user!.userId;
  const data = await db.select().from(notificationsTable)
    .where(eq(notificationsTable.userId, userId))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(50);
  res.json(data);
});

router.patch("/notifications/read-all", authenticate, async (req, res) => {
  const userId = req.user!.userId;
  await db.update(notificationsTable).set({ isRead: true }).where(eq(notificationsTable.userId, userId));
  res.json({ message: "All marked as read" });
});

router.patch("/notifications/:id/read", authenticate, async (req, res) => {
  const id = req.params.id as string;
  const userId = req.user!.userId;
  const [n] = await db.update(notificationsTable)
    .set({ isRead: true })
    .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, userId)))
    .returning();
  res.json(n);
});

export default router;
