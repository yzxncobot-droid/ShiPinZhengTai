import { Router } from "express";
import bcrypt from "bcrypt";
import { nanoid } from "nanoid";
import { db } from "@workspace/db";
import {
  usersTable, userSubscriptionsTable, subscriptionsTable,
  walletsTable, referralsTable, notificationsTable,
  walletTransactionsTable, loginHistoryTable,
} from "@workspace/db";
import { eq, and, gte, ilike, or } from "drizzle-orm";
import { authenticate, signToken } from "../middlewares/auth";
import { createSession, deleteSession, invalidateUserCache } from "../lib/redis";
import { authRateLimit } from "../middlewares/rate-limit";
import { logger } from "../lib/logger";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

export function formatUser(user: typeof usersTable.$inferSelect, activeSub?: any) {
  return {
    id: user.id,
    username: user.username,
    email: user.email ?? null,
    role: user.role,
    avatar: user.avatar ?? null,
    isBanned: user.isBanned,
    walletBalance: user.walletBalance,
    totalTopup: user.totalTopup,
    totalSpent: user.totalSpent,
    subscriptionStatus: user.subscriptionStatus,
    subscriptionExpiry: user.subscriptionExpiry ?? null,
    referralCode: user.referralCode ?? null,
    createdAt: user.createdAt,
    activeSubscription: activeSub ?? null,
  };
}

export async function getActiveSubscription(userId: string) {
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
      ),
    )
    .limit(1);
  return sub ?? null;
}

/** Ensure a wallet ledger row exists for a user (idempotent). */
async function ensureWallet(userId: string) {
  await db.insert(walletsTable)
    .values({ userId, balance: 0, totalEarned: 0, totalSpent: 0 })
    .onConflictDoNothing();
}

/** Generate a unique 8-char referral code, retrying on collision. */
async function generateReferralCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = nanoid(8).toUpperCase();
    const [existing] = await db.select({ id: usersTable.id })
      .from(usersTable).where(eq(usersTable.referralCode, code)).limit(1);
    if (!existing) return code;
  }
  return nanoid(12).toUpperCase();
}

// ── POST /auth/register ───────────────────────────────────────────────────────
router.post("/auth/register", authRateLimit, async (req, res) => {
  const { username, password, email, referralCode } = req.body;

  if (!username?.trim() || !password) {
    res.status(400).json({ error: "Username dan password wajib diisi" });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: "Password minimal 6 karakter" });
    return;
  }
  if (username.trim().length < 3) {
    res.status(400).json({ error: "Username minimal 3 karakter" });
    return;
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username.trim())) {
    res.status(400).json({ error: "Username hanya boleh mengandung huruf, angka, dan underscore" });
    return;
  }

  const [existingUsername] = await db.select({ id: usersTable.id })
    .from(usersTable).where(ilike(usersTable.username, username.trim())).limit(1);
  if (existingUsername) {
    res.status(409).json({ error: "Username sudah digunakan" });
    return;
  }

  if (email) {
    const [existingEmail] = await db.select({ id: usersTable.id })
      .from(usersTable).where(eq(usersTable.email, email.toLowerCase().trim())).limit(1);
    if (existingEmail) {
      res.status(409).json({ error: "Email sudah terdaftar" });
      return;
    }
  }

  // Resolve referrer
  let referrerId: string | null = null;
  if (referralCode) {
    const [referrer] = await db.select({ id: usersTable.id, referralCode: usersTable.referralCode })
      .from(usersTable).where(eq(usersTable.referralCode, referralCode.toUpperCase())).limit(1);
    if (referrer) referrerId = referrer.id;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const newReferralCode = await generateReferralCode();

  try {
    const [user] = await db.insert(usersTable).values({
      username: username.trim(),
      email: email ? email.toLowerCase().trim() : undefined,
      passwordHash,
      role: "meril",
      referralCode: newReferralCode,
      referredBy: referrerId ?? undefined,
    }).returning();

    await ensureWallet(user.id);

    if (referrerId) {
      await db.insert(referralsTable).values({
        referrerId,
        referredId: user.id,
        codeUsed: referralCode.toUpperCase(),
        status: "pending",
      }).onConflictDoNothing();
    }

    await db.insert(notificationsTable).values({
      userId: user.id,
      title: "Selamat Datang! 🎉",
      message: `Halo ${user.username}! Akun kamu berhasil dibuat. Selamat menikmati konten kami!`,
      type: "system",
    });

    const { token, jti } = signToken(user.id, user.role);

    // Store session in Redis
    await createSession(jti, {
      userId: user.id,
      role: user.role,
      username: user.username,
      createdAt: Date.now(),
    });

    // Record login history
    await db.insert(loginHistoryTable).values({
      userId: user.id,
      identifier: user.username,
      ipAddress: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
      success: true,
      sessionId: jti,
    });

    logger.info({ userId: user.id, username: user.username }, "New user registered");
    res.status(201).json({ token, user: formatUser(user) });
  } catch (err: any) {
    const pgCode = err?.code ?? err?.cause?.code;
    if (pgCode === "23505") {
      res.status(409).json({ error: "Username atau email sudah digunakan" });
      return;
    }
    logger.error({ err }, "Registration failed");
    res.status(500).json({ error: "Registrasi gagal, coba lagi" });
  }
});

// ── POST /auth/login ──────────────────────────────────────────────────────────
router.post("/auth/login", authRateLimit, async (req, res) => {
  const { username, email, password } = req.body;
  const identifier = (username ?? email ?? "").trim();

  if (!identifier || !password) {
    res.status(400).json({ error: "Username dan password wajib diisi" });
    return;
  }

  const [user] = await db.select().from(usersTable)
    .where(
      or(
        ilike(usersTable.username, identifier),
        eq(usersTable.email, identifier.toLowerCase()),
      ),
    )
    .limit(1);

  if (!user) {
    // Record failed attempt (user not found)
    await db.insert(loginHistoryTable).values({
      identifier,
      ipAddress: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
      success: false,
      failureReason: "not_found",
    }).catch(() => {});
    res.status(401).json({ error: "Username atau password salah" });
    return;
  }

  if (user.isBanned) {
    await db.insert(loginHistoryTable).values({
      userId: user.id,
      identifier,
      ipAddress: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
      success: false,
      failureReason: "banned",
    }).catch(() => {});
    res.status(403).json({ error: "Akun kamu diblokir. Hubungi admin untuk info lebih lanjut." });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    await db.insert(loginHistoryTable).values({
      userId: user.id,
      identifier,
      ipAddress: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
      success: false,
      failureReason: "invalid_password",
    }).catch(() => {});
    res.status(401).json({ error: "Username atau password salah" });
    return;
  }

  await ensureWallet(user.id);

  // Sync subscription cache
  const activeSub = await getActiveSubscription(user.id);
  const now = new Date();
  const subStatus = activeSub && new Date(activeSub.endDate) > now ? "active"
    : user.subscriptionExpiry && new Date(user.subscriptionExpiry) < now ? "expired"
    : "none";

  if (user.subscriptionStatus !== subStatus) {
    await db.update(usersTable).set({
      subscriptionStatus: subStatus as any,
      updatedAt: new Date(),
    }).where(eq(usersTable.id, user.id));
  }

  const { token, jti } = signToken(user.id, user.role);

  // Store session in Redis
  await createSession(jti, {
    userId: user.id,
    role: user.role,
    username: user.username,
    createdAt: Date.now(),
  });

  // Record successful login
  await db.insert(loginHistoryTable).values({
    userId: user.id,
    identifier,
    ipAddress: req.ip ?? null,
    userAgent: req.headers["user-agent"] ?? null,
    success: true,
    sessionId: jti,
  }).catch(() => {});

  // Invalidate any stale user cache
  await invalidateUserCache(user.id);

  logger.info({ userId: user.id, username: user.username }, "User logged in");
  res.json({ token, user: formatUser({ ...user, subscriptionStatus: subStatus as any }, activeSub) });
});

// ── GET /auth/me ──────────────────────────────────────────────────────────────
router.get("/auth/me", authenticate, async (req, res) => {
  const [user] = await db.select().from(usersTable)
    .where(eq(usersTable.id, req.user!.userId)).limit(1);
  if (!user) {
    res.status(404).json({ error: "User tidak ditemukan" });
    return;
  }
  const activeSub = await getActiveSubscription(user.id);
  res.json(formatUser(user, activeSub));
});

// ── POST /auth/logout ─────────────────────────────────────────────────────────
router.post("/auth/logout", authenticate, async (req, res) => {
  const { jti } = req.user!;
  if (jti) {
    await deleteSession(jti).catch(() => {});
    await invalidateUserCache(req.user!.userId).catch(() => {});
  }
  res.json({ message: "Logged out" });
});

export default router;
