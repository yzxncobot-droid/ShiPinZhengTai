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
    creatorBadge: user.creatorBadge ?? false,
    verifiedCreator: user.verifiedCreator ?? false,
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
router.post("/auth/register", authRateLimit, async (req, res, next) => {
  try {
    const { username, password, email, referralCode } = req.body;

    logger.info({ username, hasEmail: !!email, hasReferral: !!referralCode }, "Registration attempt");

    // ── Input validation ─────────────────────────────────────────────────────
    if (!username?.trim() || !password) {
      res.status(400).json({ success: false, code: "MISSING_FIELDS", message: "Username dan password wajib diisi" });
      return;
    }
    if (username.trim().length < 3) {
      res.status(400).json({ success: false, code: "USERNAME_TOO_SHORT", message: "Username minimal 3 karakter" });
      return;
    }
    if (username.trim().length > 30) {
      res.status(400).json({ success: false, code: "USERNAME_TOO_LONG", message: "Username maksimal 30 karakter" });
      return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username.trim())) {
      res.status(400).json({ success: false, code: "USERNAME_INVALID_FORMAT", message: "Username hanya boleh mengandung huruf, angka, dan underscore" });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ success: false, code: "PASSWORD_TOO_SHORT", message: "Password minimal 6 karakter" });
      return;
    }

    // ── Uniqueness checks ────────────────────────────────────────────────────
    const [existingUsername] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(ilike(usersTable.username, username.trim()))
      .limit(1);
    if (existingUsername) {
      logger.info({ username }, "Registration rejected: username taken");
      res.status(409).json({ success: false, code: "USERNAME_ALREADY_EXISTS", message: "Username sudah digunakan" });
      return;
    }

    if (email) {
      const [existingEmail] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.email, email.toLowerCase().trim()))
        .limit(1);
      if (existingEmail) {
        res.status(409).json({ success: false, code: "EMAIL_ALREADY_EXISTS", message: "Email sudah terdaftar" });
        return;
      }
    }

    // ── Resolve referrer ─────────────────────────────────────────────────────
    let referrerId: string | null = null;
    if (referralCode) {
      const [referrer] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.referralCode, referralCode.toUpperCase()))
        .limit(1);
      if (referrer) referrerId = referrer.id;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const newReferralCode = await generateReferralCode();

    // ── Create user ──────────────────────────────────────────────────────────
    let user: typeof usersTable.$inferSelect;
    try {
      const [inserted] = await db.insert(usersTable).values({
        username: username.trim(),
        email: email ? email.toLowerCase().trim() : undefined,
        passwordHash,
        role: "meril",
        referralCode: newReferralCode,
        referredBy: referrerId ?? undefined,
      }).returning();
      user = inserted;
    } catch (insertErr: any) {
      const pgCode = insertErr?.code ?? insertErr?.cause?.code;
      logger.error({ insertErr, pgCode }, "Registration: DB insert failed");
      if (pgCode === "23505") {
        res.status(409).json({ success: false, code: "USERNAME_ALREADY_EXISTS", message: "Username atau email sudah digunakan" });
      } else {
        res.status(500).json({ success: false, code: "DB_INSERT_FAILED", message: `Database insert failed: ${insertErr?.message ?? pgCode ?? "unknown"}` });
      }
      return;
    }

    // ── Post-registration side-effects (non-fatal) ───────────────────────────
    await ensureWallet(user.id).catch((err: any) => logger.error({ err }, "ensureWallet failed"));

    if (referrerId) {
      await db.insert(referralsTable).values({
        referrerId,
        referredId: user.id,
        codeUsed: referralCode.toUpperCase(),
        status: "pending",
      }).onConflictDoNothing().catch((err: any) => logger.error({ err }, "referral insert failed"));
    }

    await db.insert(notificationsTable).values({
      userId: user.id,
      title: "Selamat Datang! 🎉",
      message: `Halo ${user.username}! Akun kamu berhasil dibuat. Selamat menikmati konten kami!`,
      type: "system",
    }).catch((err: any) => logger.error({ err }, "welcome notification failed"));

    // ── Issue token & session ─────────────────────────────────────────────────
    const { token, jti } = signToken(user.id, user.role);
    await createSession(jti, { userId: user.id, role: user.role, username: user.username, createdAt: Date.now() })
      .catch((err: any) => logger.warn({ err }, "createSession failed — JWT-only auth active"));

    await db.insert(loginHistoryTable).values({
      userId: user.id,
      identifier: user.username,
      ipAddress: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
      success: true,
      sessionId: jti,
    }).catch(() => {});

    logger.info({ userId: user.id, username: user.username }, "New user registered successfully");
    res.status(201).json({ success: true, message: "Akun berhasil dibuat", token, user: formatUser(user) });
  } catch (err) {
    next(err);
  }
});

// ── POST /auth/login ──────────────────────────────────────────────────────────
router.post("/auth/login", authRateLimit, async (req, res, next) => {
  try {
    const { username, email, password } = req.body;
    const identifier = (username ?? email ?? "").trim();

    logger.info({ identifier }, "Login attempt");

    if (!identifier || !password) {
      res.status(400).json({ success: false, code: "MISSING_FIELDS", message: "Username dan password wajib diisi" });
      return;
    }

    // ── Look up user ─────────────────────────────────────────────────────────
    let user: typeof usersTable.$inferSelect | undefined;
    try {
      const [found] = await db.select().from(usersTable)
        .where(or(
          ilike(usersTable.username, identifier),
          eq(usersTable.email, identifier.toLowerCase()),
        ))
        .limit(1);
      user = found;
    } catch (dbErr: any) {
      logger.error({ dbErr }, "Login: DB lookup failed");
      res.status(500).json({ success: false, code: "DB_LOOKUP_FAILED", message: `Database lookup failed: ${dbErr?.message ?? "unknown"}` });
      return;
    }

    if (!user) {
      await db.insert(loginHistoryTable).values({
        identifier, ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
        success: false, failureReason: "not_found",
      }).catch(() => {});
      logger.info({ identifier }, "Login failed: user not found");
      res.status(401).json({ success: false, code: "USER_NOT_FOUND", message: "Username atau password salah" });
      return;
    }

    if (user.isBanned) {
      await db.insert(loginHistoryTable).values({
        userId: user.id, identifier, ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
        success: false, failureReason: "banned",
      }).catch(() => {});
      logger.info({ userId: user.id }, "Login failed: account banned");
      res.status(403).json({ success: false, code: "ACCOUNT_BANNED", message: "Akun kamu diblokir. Hubungi admin untuk info lebih lanjut." });
      return;
    }

    // ── Password check ────────────────────────────────────────────────────────
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      await db.insert(loginHistoryTable).values({
        userId: user.id, identifier, ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
        success: false, failureReason: "invalid_password",
      }).catch(() => {});
      logger.info({ userId: user.id }, "Login failed: invalid password");
      res.status(401).json({ success: false, code: "INVALID_PASSWORD", message: "Username atau password salah" });
      return;
    }

    await ensureWallet(user.id).catch((err: any) => logger.error({ err }, "ensureWallet failed"));

    // ── Sync subscription cache ───────────────────────────────────────────────
    const activeSub = await getActiveSubscription(user.id).catch(() => null);
    const now = new Date();
    const subStatus = activeSub && new Date(activeSub.endDate) > now ? "active"
      : user.subscriptionExpiry && new Date(user.subscriptionExpiry) < now ? "expired"
      : "none";

    if (user.subscriptionStatus !== subStatus) {
      await db.update(usersTable)
        .set({ subscriptionStatus: subStatus as any, updatedAt: new Date() })
        .where(eq(usersTable.id, user.id))
        .catch((err: any) => logger.error({ err }, "subscription sync failed"));
    }

    // ── Issue token & session ─────────────────────────────────────────────────
    const { token, jti } = signToken(user.id, user.role);
    await createSession(jti, { userId: user.id, role: user.role, username: user.username, createdAt: Date.now() })
      .catch((err: any) => logger.warn({ err }, "createSession failed — JWT-only auth active"));

    await db.insert(loginHistoryTable).values({
      userId: user.id, identifier, ipAddress: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
      success: true, sessionId: jti,
    }).catch(() => {});

    await invalidateUserCache(user.id).catch(() => {});

    // ── Gamification: update login streak & award daily login EXP ─────────────
    import("../lib/gamification").then(({ onLogin }) =>
      onLogin(user.id).catch((err: any) => logger.warn({ err }, "gamification onLogin failed")),
    );

    logger.info({ userId: user.id, username: user.username }, "User logged in successfully");
    res.json({
      success: true,
      message: "Login berhasil",
      token,
      user: formatUser({ ...user, subscriptionStatus: subStatus as any }, activeSub),
    });
  } catch (err) {
    next(err);
  }
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
