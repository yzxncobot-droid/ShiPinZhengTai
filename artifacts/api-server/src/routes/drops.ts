import { Router } from "express";
import { db } from "@workspace/db";
import {
  usersTable, dropsTable, dropClaimsTable, dropLogsTable,
  userSubscriptionsTable, subscriptionsTable,
} from "@workspace/db";
import {
  eq, and, sql, desc, lt, gt, gte, lte, inArray, count,
} from "drizzle-orm";
import { authenticate, optionalAuth, requireRole } from "../middlewares/auth";

const router = Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Activate any scheduled drops whose start_time has passed. */
async function activateScheduledDrops() {
  await db.update(dropsTable)
    .set({ status: "active", updatedAt: new Date() })
    .where(and(
      eq(dropsTable.status, "scheduled"),
      lte(dropsTable.startTime, new Date()),
    ));
}

/** Complete any active drops whose end_time has passed or maxWinners reached. */
async function completeExpiredDrops() {
  await db.update(dropsTable)
    .set({ status: "completed", updatedAt: new Date() })
    .where(and(
      eq(dropsTable.status, "active"),
      lte(dropsTable.endTime, new Date()),
    ));
}

/** Grant reward to a user based on drop reward type. */
async function grantReward(
  dropId: string, userId: string, rewardType: string,
  rewardAmount: number | null, rewardValue: string,
): Promise<{ granted: boolean; details: string }> {
  try {
    if (rewardType === "wallet_balance" || rewardType === "coins") {
      const amount = rewardAmount ?? parseFloat(rewardValue) ?? 0;
      if (amount > 0) {
        await db.update(usersTable)
          .set({
            walletBalance: sql`${usersTable.walletBalance} + ${amount}`,
            updatedAt: new Date(),
          })
          .where(eq(usersTable.id, userId));
        return { granted: true, details: `+${amount} coins added to wallet` };
      }
    }

    if (rewardType === "premium_subscription") {
      // Find cheapest active plan or use first available
      const days = parseInt(rewardValue) || 30;
      const expiry = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      await db.update(usersTable)
        .set({
          subscriptionStatus: "active",
          subscriptionExpiry: expiry,
          updatedAt: new Date(),
        })
        .where(eq(usersTable.id, userId));
      return { granted: true, details: `Premium subscription granted for ${days} days` };
    }

    // For other types (coupon, redeem_code, custom, badge, xp):
    // Log the reward — fulfillment is manual or via separate system
    return { granted: true, details: `${rewardType}: ${rewardValue}` };
  } catch (err: any) {
    return { granted: false, details: `Error: ${err.message}` };
  }
}

// ── Owner/Admin: create a drop ───────────────────────────────────────────────

router.post("/drops", authenticate, requireRole("admin", "owner"), async (req, res) => {
  try {
    const ownerId = req.user!.userId;
    const {
      title, description, rewardType, rewardValue, rewardAmount,
      maxWinners, startTime, endTime, buttonColor, roomId,
    } = req.body;

    if (!title?.trim() || !rewardType || rewardValue == null || !startTime || !endTime) {
      res.status(400).json({ error: "title, rewardType, rewardValue, startTime, endTime are required" });
      return;
    }

    const start = new Date(startTime);
    const end   = new Date(endTime);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
      res.status(400).json({ error: "Invalid startTime/endTime" });
      return;
    }

    const status = start <= new Date() ? "active" : "scheduled";

    const [drop] = await db.insert(dropsTable).values({
      title: title.trim(),
      description: description?.trim() ?? null,
      rewardType,
      rewardValue: String(rewardValue),
      rewardAmount: rewardAmount ? Number(rewardAmount) : null,
      maxWinners: parseInt(maxWinners) || 100,
      startTime: start,
      endTime: end,
      status,
      buttonColor: buttonColor ?? "#8b5cf6",
      roomId: roomId ?? null,
      createdBy: ownerId,
    }).returning();

    await db.insert(dropLogsTable).values({
      dropId: drop.id,
      userId: ownerId,
      action: "created",
      details: JSON.stringify({ title, rewardType, maxWinners }),
    });

    res.status(201).json(drop);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Public: active drops (for chat display) ───────────────────────────────────

router.get("/drops/active", optionalAuth, async (req, res) => {
  try {
    await activateScheduledDrops();
    await completeExpiredDrops();

    // Optional roomId filter — if provided, only show drops for that room OR global drops
    const roomIdFilter = req.query.roomId as string | undefined;

    const whereClause = roomIdFilter
      ? and(
          eq(dropsTable.status, "active"),
          // show room-specific drops for this room, plus global drops (null roomId)
          sql`(${dropsTable.roomId} = ${roomIdFilter} OR ${dropsTable.roomId} IS NULL)`,
        )
      : eq(dropsTable.status, "active");

    const drops = await db
      .select({
        id: dropsTable.id,
        title: dropsTable.title,
        description: dropsTable.description,
        rewardType: dropsTable.rewardType,
        rewardValue: dropsTable.rewardValue,
        rewardAmount: dropsTable.rewardAmount,
        maxWinners: dropsTable.maxWinners,
        currentClaims: dropsTable.currentClaims,
        startTime: dropsTable.startTime,
        endTime: dropsTable.endTime,
        buttonColor: dropsTable.buttonColor,
        roomId: dropsTable.roomId,
      })
      .from(dropsTable)
      .where(whereClause)
      .orderBy(dropsTable.startTime);

    const userId = req.user?.userId;
    if (!userId) {
      res.json(drops.map((d: any) => ({ ...d, claimed: false })));
      return;
    }

    // Check which ones the user has claimed
    const claimedSet = new Set(
      (await db.select({ dropId: dropClaimsTable.dropId })
        .from(dropClaimsTable)
        .where(and(
          eq(dropClaimsTable.userId, userId),
          inArray(dropClaimsTable.dropId, drops.map((d: any) => d.id)),
        ))).map((c: any) => c.dropId),
    );

    res.json(drops.map((d: any) => ({ ...d, claimed: claimedSet.has(d.id) })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Owner/Admin: list all drops ───────────────────────────────────────────────

router.get("/drops", authenticate, requireRole("admin", "owner"), async (req, res) => {
  try {
    await activateScheduledDrops();
    await completeExpiredDrops();

    const drops = await db
      .select()
      .from(dropsTable)
      .orderBy(desc(dropsTable.createdAt));

    // Attach claim counts
    const ids = drops.map((d: any) => d.id);
    const claimCounts = ids.length > 0
      ? await db.select({
          dropId: dropClaimsTable.dropId,
          cnt: sql<number>`cast(count(*) as int)`,
        })
        .from(dropClaimsTable)
        .where(inArray(dropClaimsTable.dropId, ids))
        .groupBy(dropClaimsTable.dropId)
      : [];
    const countMap = Object.fromEntries(claimCounts.map((c: any) => [c.dropId, c.cnt]));

    res.json(drops.map((d: any) => ({ ...d, claimCount: countMap[d.id] ?? 0 })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Public: single drop ───────────────────────────────────────────────────────

router.get("/drops/:id", optionalAuth, async (req, res) => {
  try {
    await activateScheduledDrops();
    await completeExpiredDrops();

    const [drop] = await db.select().from(dropsTable)
      .where(eq(dropsTable.id, req.params.id as string));
    if (!drop) { res.status(404).json({ error: "Drop not found" }); return; }

    const userId = req.user?.userId;
    let claimed = false;
    if (userId) {
      const [c] = await db.select({ id: dropClaimsTable.id })
        .from(dropClaimsTable)
        .where(and(
          eq(dropClaimsTable.dropId, drop.id),
          eq(dropClaimsTable.userId, userId),
        ));
      claimed = !!c;
    }
    res.json({ ...drop, claimed });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Authenticated: claim a drop ───────────────────────────────────────────────
// Anti-cheat: atomic UPDATE with row-level check + DB unique constraint on (dropId, userId)

router.post("/drops/:id/claim", authenticate, async (req, res) => {
  const userId  = req.user!.userId;
  const dropId  = req.params.id as string;

  try {
    // --- Atomic slot reservation ---
    // UPDATE ... SET current_claims = current_claims + 1
    // WHERE conditions are all met → if 0 rows updated, one of them failed
    const result = await db.execute(sql`
      UPDATE drops
      SET current_claims = current_claims + 1,
          updated_at      = now()
      WHERE id            = ${dropId}
        AND status        = 'active'
        AND current_claims < max_winners
        AND start_time   <= now()
        AND end_time      > now()
        AND NOT EXISTS (
          SELECT 1 FROM drop_claims
          WHERE drop_id = ${dropId}
            AND user_id = ${userId}
        )
      RETURNING id, reward_type, reward_value, reward_amount, title
    `);

    const rows = (result as any).rows ?? (result as any);
    if (!rows || rows.length === 0) {
      // Determine why
      const [drop] = await db.select({
        status: dropsTable.status,
        currentClaims: dropsTable.currentClaims,
        maxWinners: dropsTable.maxWinners,
        endTime: dropsTable.endTime,
        startTime: dropsTable.startTime,
      }).from(dropsTable).where(eq(dropsTable.id, dropId));

      if (!drop) { res.status(404).json({ error: "Drop not found" }); return; }
      if (drop.status !== "active") {
        res.status(409).json({ error: "Drop is not active" }); return;
      }
      if (new Date() > drop.endTime) {
        res.status(409).json({ error: "Drop has ended" }); return;
      }
      if (drop.currentClaims >= drop.maxWinners) {
        res.status(409).json({ error: "All rewards have been claimed" }); return;
      }

      // Check duplicate claim
      const [existing] = await db.select({ id: dropClaimsTable.id })
        .from(dropClaimsTable)
        .where(and(
          eq(dropClaimsTable.dropId, dropId),
          eq(dropClaimsTable.userId, userId),
        ));
      if (existing) {
        res.status(409).json({ error: "You have already claimed this drop" }); return;
      }
      res.status(409).json({ error: "Claim failed. Drop may not be active yet." });
      return;
    }

    const dropRow = rows[0];

    // --- Record the claim ---
    // Unique index (dropId, userId) is the final guard against races
    let claimId: string;
    try {
      const [claim] = await db.insert(dropClaimsTable).values({
        dropId,
        userId,
        rewardGranted: false,
      }).returning();
      claimId = claim.id;
    } catch (dupErr: any) {
      // Unique constraint violation — race-condition duplicate
      // Roll back the counter increment
      await db.execute(sql`
        UPDATE drops SET current_claims = current_claims - 1, updated_at = now()
        WHERE id = ${dropId} AND current_claims > 0
      `);
      res.status(409).json({ error: "You have already claimed this drop" });
      return;
    }

    // --- Grant the reward ---
    const reward = await grantReward(
      dropId, userId,
      dropRow.reward_type ?? dropRow.rewardType,
      dropRow.reward_amount ?? dropRow.rewardAmount,
      dropRow.reward_value ?? dropRow.rewardValue,
    );

    // Update claim with result
    await db.update(dropClaimsTable)
      .set({ rewardGranted: reward.granted, rewardDetails: reward.details })
      .where(eq(dropClaimsTable.id, claimId));

    // Log the claim
    await db.insert(dropLogsTable).values({
      dropId,
      userId,
      action: reward.granted ? "reward_granted" : "reward_failed",
      details: reward.details,
    });

    // Auto-complete if fully claimed
    const [updatedDrop] = await db.select({
      currentClaims: dropsTable.currentClaims,
      maxWinners: dropsTable.maxWinners,
    }).from(dropsTable).where(eq(dropsTable.id, dropId));

    if (updatedDrop && updatedDrop.currentClaims >= updatedDrop.maxWinners) {
      await db.update(dropsTable)
        .set({ status: "completed", updatedAt: new Date() })
        .where(eq(dropsTable.id, dropId));
    }

    res.status(201).json({
      success: true,
      rewardGranted: reward.granted,
      rewardDetails: reward.details,
      title: dropRow.title,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Owner: cancel a drop ──────────────────────────────────────────────────────

router.patch("/drops/:id/cancel", authenticate, requireRole("owner"), async (req, res) => {
  try {
    const ownerId = req.user!.userId;
    const [drop] = await db.select().from(dropsTable)
      .where(eq(dropsTable.id, req.params.id as string));
    if (!drop) { res.status(404).json({ error: "Drop not found" }); return; }
    if (!["scheduled", "active"].includes(drop.status)) {
      res.status(409).json({ error: "Only scheduled or active drops can be cancelled" });
      return;
    }
    await db.update(dropsTable)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(dropsTable.id, drop.id));
    await db.insert(dropLogsTable).values({
      dropId: drop.id, userId: ownerId, action: "cancelled",
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Owner: list claims for a drop ─────────────────────────────────────────────

router.get("/drops/:id/claims", authenticate, requireRole("owner"), async (req, res) => {
  try {
    const claims = await db
      .select({
        id: dropClaimsTable.id,
        userId: dropClaimsTable.userId,
        claimedAt: dropClaimsTable.claimedAt,
        rewardGranted: dropClaimsTable.rewardGranted,
        rewardDetails: dropClaimsTable.rewardDetails,
        username: usersTable.username,
        avatar: usersTable.avatar,
      })
      .from(dropClaimsTable)
      .innerJoin(usersTable, eq(dropClaimsTable.userId, usersTable.id))
      .where(eq(dropClaimsTable.dropId, req.params.id as string))
      .orderBy(dropClaimsTable.claimedAt);
    res.json(claims);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Authenticated: my drop history ───────────────────────────────────────────

router.get("/users/me/drop-history", authenticate, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const history = await db
      .select({
        claimId: dropClaimsTable.id,
        claimedAt: dropClaimsTable.claimedAt,
        rewardGranted: dropClaimsTable.rewardGranted,
        rewardDetails: dropClaimsTable.rewardDetails,
        dropTitle: dropsTable.title,
        rewardType: dropsTable.rewardType,
        rewardValue: dropsTable.rewardValue,
        rewardAmount: dropsTable.rewardAmount,
        dropStatus: dropsTable.status,
      })
      .from(dropClaimsTable)
      .innerJoin(dropsTable, eq(dropClaimsTable.dropId, dropsTable.id))
      .where(eq(dropClaimsTable.userId, userId))
      .orderBy(desc(dropClaimsTable.claimedAt));
    res.json(history);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
