import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { authenticate } from "../middlewares/auth";

const router = Router();

router.get("/wallet", authenticate, async (req, res) => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
  if (!user) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ userId: user.id, balance: user.walletBalance, totalTopup: user.totalTopup, totalSpent: user.totalSpent });
});

export default router;
