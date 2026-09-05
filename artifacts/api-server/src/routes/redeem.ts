import { Router } from "express";
import { db } from "@workspace/db";
import {
  usersTable,
  redeemCodesTable,
  redeemHistoryTable,
  subscriptionsTable,
  userSubscriptionsTable,
} from "@workspace/db";
import { eq, and, desc, sql, ilike, or, count, gt, asc } from "drizzle-orm";
import { authenticate, requireRole } from "../middlewares/auth";
import { rateLimit } from "../middlewares/rate-limit";
import { logger } from "../lib/logger";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

const REDEEM_RATE_LIMIT = rateLimit({
  max: 10,
  windowSeconds: 60,
  endpoint: "redeem:attempt",
  message: "Terlalu banyak percobaan. Coba lagi dalam 1 menit.",
});

/**
 * Grant the reward to the user using the supplied db/tx client.
 * Must always be called inside a transaction so failures roll back atomically.
 */
async function grantReward(
  tx: typeof db,
  userId: string,
  rewardType: string,
  rewardValue: number,
  rewardName: string,
): Promise<string> {
  switch (rewardType) {
    case "coin":
    case "wallet_balance": {
      await tx
        .update(usersTable)
        .set({
          walletBalance: sql`${usersTable.walletBalance} + ${rewardValue}`,
          updatedAt: new Date(),
        })
        .where(eq(usersTable.id, userId));
      return rewardType === "coin"
        ? `+${rewardValue.toLocaleString("id-ID")} Koin`
        : `+Rp ${rewardValue.toLocaleString("id-ID")} saldo wallet`;
    }

    case "premium_membership": {
      const days = Math.max(1, Math.floor(rewardValue));
      const startDate = new Date();
      const endDate = new Date(startDate.getTime() + days * 86_400_000);

      // Find the closest-duration active plan to use as the subscriptionId FK.
      // Fall back to any active plan if none matches exactly.
      const [matchedPlan] = await tx
        .select({ id: subscriptionsTable.id, durationDays: subscriptionsTable.durationDays })
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.isActive, true))
        .orderBy(
          sql`ABS(${subscriptionsTable.durationDays} - ${days})`,
          asc(subscriptionsTable.durationDays),
        )
        .limit(1);

      if (matchedPlan) {
        // Deactivate any existing active subscription for this user
        await tx
          .update(userSubscriptionsTable)
          .set({ isActive: false })
          .where(
            and(
              eq(userSubscriptionsTable.userId, userId),
              eq(userSubscriptionsTable.isActive, true),
            ),
          );

        // Insert the new subscription record (pricePaid = 0 — it's a redeem)
        await tx.insert(userSubscriptionsTable).values({
          userId,
          subscriptionId: matchedPlan.id,
          startDate,
          endDate,
          isActive: true,
          pricePaid: 0,
        });
      }

      // Always sync the denormalised cache on users table
      await tx
        .update(usersTable)
        .set({ subscriptionStatus: "active", subscriptionExpiry: endDate, updatedAt: new Date() })
        .where(eq(usersTable.id, userId));

      return `Premium ${days} hari hingga ${endDate.toLocaleDateString("id-ID")}`;
    }

    case "badge":
      return `Badge: ${rewardName}`;

    // bundle, video_unlock, coupon, discount, custom — noted in history, fulfilled manually
    default:
      return `${rewardName} (${rewardType}: ${rewardValue})`;
  }
}

// ── POST /redeem  ─────────────────────────────────────────────────────────────

router.post("/redeem", authenticate, REDEEM_RATE_LIMIT, async (req, res) => {
  const userId = req.user!.userId;
  let { code } = req.body as { code?: string };

  if (!code?.trim()) {
    res.status(400).json({ error: "Kode tidak boleh kosong." });
    return;
  }

  code = code.trim().toUpperCase();

  try {
    // ── 1. Read-only pre-flight for user-friendly error messages ─────────────
    //    (No write yet — race-safe because real guards are inside the tx below.)
    const [rc] = await db
      .select()
      .from(redeemCodesTable)
      .where(eq(redeemCodesTable.code, code))
      .limit(1);

    if (!rc) {
      res.status(404).json({ status: "not_found", error: "Kode tidak ditemukan." });
      return;
    }
    if (!rc.isActive) {
      res.status(400).json({ status: "not_active", error: "Kode belum aktif atau telah dinonaktifkan." });
      return;
    }
    if (rc.expiresAt && rc.expiresAt < new Date()) {
      res.status(400).json({ status: "expired", error: "Kode telah kedaluwarsa." });
      return;
    }
    if (rc.maxUse > 0 && rc.usedCount >= rc.maxUse) {
      res.status(400).json({ status: "limit_reached", error: "Batas penggunaan kode telah tercapai." });
      return;
    }

    // ── 2. Fully-atomic claim transaction ────────────────────────────────────
    //
    //  Order of operations inside the tx:
    //    a) Conditional UPDATE on redeem_codes — atomically increments used_count
    //       only when all validity conditions still hold at commit time.
    //       Returns 0 rows if the code was deactivated, expired, or hit its
    //       limit between the pre-flight read above and now.
    //    b) INSERT into redeem_history — the UNIQUE index on (userId, codeId)
    //       makes this the idempotency guard: a concurrent request that slips
    //       past the pre-flight will fail here with 23505 and roll back.
    //    c) grantReward via `tx` — any DB error rolls back both (a) and (b),
    //       leaving the code fully unclaimed and the user's balance untouched.
    //
    const details = await db.transaction(async (tx: any) => {
      const now = new Date();

      // (a) Atomic conditional increment ──────────────────────────────────────
      const [claimed] = await tx
        .update(redeemCodesTable)
        .set({ usedCount: sql`${redeemCodesTable.usedCount} + 1`, updatedAt: now })
        .where(
          and(
            eq(redeemCodesTable.id, rc.id),
            eq(redeemCodesTable.isActive, true),
            or(
              sql`${redeemCodesTable.expiresAt} IS NULL`,
              gt(redeemCodesTable.expiresAt!, now),
            ),
            or(
              eq(redeemCodesTable.maxUse, 0),
              sql`${redeemCodesTable.usedCount} < ${redeemCodesTable.maxUse}`,
            ),
          ),
        )
        .returning({ id: redeemCodesTable.id });

      if (!claimed) {
        // Code was deactivated/expired/exhausted after pre-flight — treat as limit reached
        throw Object.assign(
          new Error("Kode sudah habis atau tidak lagi valid."),
          { redeemStatus: "limit_reached" },
        );
      }

      // (b) Insert history — unique constraint prevents concurrent double-claim ─
      await tx.insert(redeemHistoryTable).values({
        userId,
        redeemCodeId: rc.id,
        // claimedReward will be updated after grant; insert a placeholder first
        claimedReward: null,
        status: "pending",
      });

      // (c) Apply reward — runs on tx so any failure rolls back (a) and (b) ──
      const grantDetails = await grantReward(tx as typeof db, userId, rc.rewardType, rc.rewardValue, rc.rewardName);

      // Patch the history row with the final reward details
      await tx
        .update(redeemHistoryTable)
        .set({
          claimedReward: JSON.stringify({
            rewardType: rc.rewardType,
            rewardValue: rc.rewardValue,
            rewardName: rc.rewardName,
            details: grantDetails,
          }),
          status: "success",
        })
        .where(
          and(
            eq(redeemHistoryTable.userId, userId),
            eq(redeemHistoryTable.redeemCodeId, rc.id),
          ),
        );

      return grantDetails;
    });

    res.json({
      status: "success",
      message: "Kode berhasil ditukarkan!",
      reward: {
        rewardType: rc.rewardType,
        rewardValue: rc.rewardValue,
        rewardName: rc.rewardName,
        description: rc.description,
        details,
      },
    });
  } catch (err: any) {
    // Unique constraint → this user already claimed (concurrent double-submit)
    if (err?.code === "23505") {
      res.status(400).json({ status: "used", error: "Kamu sudah pernah menggunakan kode ini." });
      return;
    }
    // Our own typed error from the conditional-update guard
    if (err?.redeemStatus) {
      res.status(400).json({ status: err.redeemStatus, error: err.message });
      return;
    }
    logger.error({ err, userId, code }, "POST /redeem failed");
    res.status(500).json({ error: err.message });
  }
});

// ── GET /redeem/history  ──────────────────────────────────────────────────────

router.get("/redeem/history", authenticate, async (req, res) => {
  const userId = req.user!.userId;
  try {
    const rows = await db
      .select({
        id: redeemHistoryTable.id,
        status: redeemHistoryTable.status,
        claimedReward: redeemHistoryTable.claimedReward,
        createdAt: redeemHistoryTable.createdAt,
        code: redeemCodesTable.code,
        rewardName: redeemCodesTable.rewardName,
        rewardType: redeemCodesTable.rewardType,
        rewardValue: redeemCodesTable.rewardValue,
      })
      .from(redeemHistoryTable)
      .innerJoin(redeemCodesTable, eq(redeemHistoryTable.redeemCodeId, redeemCodesTable.id))
      .where(eq(redeemHistoryTable.userId, userId))
      .orderBy(desc(redeemHistoryTable.createdAt))
      .limit(50);

    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /redeem/my-rewards  ───────────────────────────────────────────────────

router.get("/redeem/my-rewards", authenticate, async (req, res) => {
  const userId = req.user!.userId;
  try {
    const rows = await db
      .select({
        id: redeemHistoryTable.id,
        status: redeemHistoryTable.status,
        claimedReward: redeemHistoryTable.claimedReward,
        createdAt: redeemHistoryTable.createdAt,
        rewardName: redeemCodesTable.rewardName,
        rewardType: redeemCodesTable.rewardType,
        rewardValue: redeemCodesTable.rewardValue,
      })
      .from(redeemHistoryTable)
      .innerJoin(redeemCodesTable, eq(redeemHistoryTable.redeemCodeId, redeemCodesTable.id))
      .where(and(eq(redeemHistoryTable.userId, userId), eq(redeemHistoryTable.status, "success")))
      .orderBy(desc(redeemHistoryTable.createdAt));

    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── ADMIN: GET /admin/redeem  ─────────────────────────────────────────────────

router.get("/admin/redeem", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const { search, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  try {
    const conditions = search?.trim()
      ? or(
          ilike(redeemCodesTable.code, `%${search.trim()}%`),
          ilike(redeemCodesTable.rewardName, `%${search.trim()}%`),
        )
      : undefined;

    const [rows, [{ total }]] = await Promise.all([
      db
        .select()
        .from(redeemCodesTable)
        .where(conditions)
        .orderBy(desc(redeemCodesTable.createdAt))
        .limit(limitNum)
        .offset(offset),
      db
        .select({ total: count() })
        .from(redeemCodesTable)
        .where(conditions),
    ]);

    res.json({ data: rows, total: Number(total), page: pageNum, limit: limitNum });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── ADMIN: POST /admin/redeem  ────────────────────────────────────────────────

router.post("/admin/redeem", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const createdBy = req.user!.userId;
  const {
    code, rewardType, rewardValue, rewardName, description,
    maxUse, expiresAt, isActive,
  } = req.body;

  if (!code?.trim() || !rewardType || rewardValue == null || !rewardName?.trim()) {
    res.status(400).json({ error: "code, rewardType, rewardValue, rewardName wajib diisi." });
    return;
  }

  try {
    const [row] = await db
      .insert(redeemCodesTable)
      .values({
        code: code.trim().toUpperCase(),
        rewardType,
        rewardValue: parseFloat(rewardValue) || 0,
        rewardName: rewardName.trim(),
        description: description?.trim() ?? null,
        maxUse: parseInt(maxUse) ?? 1,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        isActive: isActive !== false,
        createdBy,
      })
      .returning();

    res.status(201).json(row);
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "Kode sudah digunakan. Pilih kode lain." });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

// ── ADMIN: PUT /admin/redeem/:id  ─────────────────────────────────────────────

router.put("/admin/redeem/:id", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const { id  } = req.params as { id: string };
  const {
    code, rewardType, rewardValue, rewardName, description,
    maxUse, expiresAt, isActive,
  } = req.body;

  try {
    const updates: Record<string, any> = { updatedAt: new Date() };
    if (code != null) updates.code = code.trim().toUpperCase();
    if (rewardType != null) updates.rewardType = rewardType;
    if (rewardValue != null) updates.rewardValue = parseFloat(rewardValue) || 0;
    if (rewardName != null) updates.rewardName = rewardName.trim();
    if (description !== undefined) updates.description = description?.trim() ?? null;
    if (maxUse != null) updates.maxUse = parseInt(maxUse);
    if (expiresAt !== undefined) updates.expiresAt = expiresAt ? new Date(expiresAt) : null;
    if (isActive != null) updates.isActive = Boolean(isActive);

    const [row] = await db
      .update(redeemCodesTable)
      .set(updates)
      .where(eq(redeemCodesTable.id, id))
      .returning();

    if (!row) {
      res.status(404).json({ error: "Kode tidak ditemukan." });
      return;
    }
    res.json(row);
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "Kode sudah digunakan. Pilih kode lain." });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

// ── ADMIN: DELETE /admin/redeem/:id  ─────────────────────────────────────────

router.delete("/admin/redeem/:id", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const { id  } = req.params as { id: string };
  try {
    const [row] = await db
      .delete(redeemCodesTable)
      .where(eq(redeemCodesTable.id, id))
      .returning({ id: redeemCodesTable.id });

    if (!row) {
      res.status(404).json({ error: "Kode tidak ditemukan." });
      return;
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── ADMIN: GET /admin/redeem/:id/history  ────────────────────────────────────

router.get("/admin/redeem/:id/history", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const { id  } = req.params as { id: string };
  try {
    const rows = await db
      .select({
        id: redeemHistoryTable.id,
        userId: redeemHistoryTable.userId,
        status: redeemHistoryTable.status,
        claimedReward: redeemHistoryTable.claimedReward,
        createdAt: redeemHistoryTable.createdAt,
        username: usersTable.username,
        avatar: usersTable.avatar,
      })
      .from(redeemHistoryTable)
      .innerJoin(usersTable, eq(redeemHistoryTable.userId, usersTable.id))
      .where(eq(redeemHistoryTable.redeemCodeId, id))
      .orderBy(desc(redeemHistoryTable.createdAt));

    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
