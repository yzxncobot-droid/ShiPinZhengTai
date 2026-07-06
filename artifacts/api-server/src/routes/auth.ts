import { Router } from "express";
import bcrypt from "bcrypt";
import { db } from "@workspace/db";
import { usersTable, userSubscriptionsTable, subscriptionsTable } from "@workspace/db";
import { eq, and, gte } from "drizzle-orm";
import { authenticate, signToken } from "../middlewares/auth";

const router = Router();

function formatUser(user: typeof usersTable.$inferSelect, activeSub?: any) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    avatar: user.avatar,
    isBanned: user.isBanned,
    walletBalance: user.walletBalance,
    totalTopup: user.totalTopup,
    totalSpent: user.totalSpent,
    createdAt: user.createdAt,
    activeSubscription: activeSub || null,
  };
}

async function getActiveSubscription(userId: number) {
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
    .where(
      and(
        eq(userSubscriptionsTable.userId, userId),
        eq(userSubscriptionsTable.isActive, true),
        gte(userSubscriptionsTable.endDate, now),
      )
    )
    .limit(1);
  return sub || null;
}

router.post("/auth/register", async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    res.status(400).json({ error: "Missing fields" });
    return;
  }
  const existing = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (existing.length > 0) {
    res.status(400).json({ error: "Email already registered" });
    return;
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const [user] = await db.insert(usersTable).values({ username, email, passwordHash }).returning();
  const token = signToken(user.id, user.role);
  res.status(201).json({ token, user: formatUser(user) });
});

router.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: "Missing fields" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (!user) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  if (user.isBanned) {
    res.status(403).json({ error: "Account is banned" });
    return;
  }
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  const activeSub = await getActiveSubscription(user.id);
  const token = signToken(user.id, user.role);
  res.json({ token, user: formatUser(user, activeSub) });
});

router.get("/auth/me", authenticate, async (req, res) => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const activeSub = await getActiveSubscription(user.id);
  res.json(formatUser(user, activeSub));
});

router.post("/auth/logout", (_req, res) => {
  res.json({ message: "Logged out" });
});

export { getActiveSubscription, formatUser };
export default router;
