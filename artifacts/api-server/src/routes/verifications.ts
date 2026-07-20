import { Router } from "express";
import { db } from "@workspace/db";
import {
  usersTable,
  creatorVerificationsTable,
  verificationHistoryTable,
} from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { authenticate, requireRole } from "../middlewares/auth";

const router = Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

const VALID_MANUAL_BADGES = ["blue", "gold"] as const;

/** Keep usersTable.verificationBadge in sync after any change. */
async function syncUserBadge(userId: string) {
  const active = await db
    .select({ badgeType: creatorVerificationsTable.badgeType })
    .from(creatorVerificationsTable)
    .where(and(
      eq(creatorVerificationsTable.userId, userId),
      eq(creatorVerificationsTable.status, "active"),
    ));
  // Priority: sulthan > gold > blue
  const priority: Record<string, number> = { sulthan: 3, gold: 2, blue: 1 };
  const best = active.sort((a, b) => (priority[b.badgeType] ?? 0) - (priority[a.badgeType] ?? 0))[0];
  await db.update(usersTable)
    .set({ verificationBadge: best?.badgeType ?? null, updatedAt: new Date() })
    .where(eq(usersTable.id, userId));
}

// ── Public: get a user's active badges ───────────────────────────────────────

router.get("/verifications/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const badges = await db
      .select({
        id: creatorVerificationsTable.id,
        badgeType: creatorVerificationsTable.badgeType,
        verifiedAt: creatorVerificationsTable.verifiedAt,
        reason: creatorVerificationsTable.reason,
      })
      .from(creatorVerificationsTable)
      .where(and(
        eq(creatorVerificationsTable.userId, userId),
        eq(creatorVerificationsTable.status, "active"),
      ));
    res.json(badges);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Owner/Admin: list all verified users ─────────────────────────────────────

router.get("/verifications", authenticate, requireRole("admin"), async (req, res) => {
  try {
    const rows = await db
      .select({
        id: creatorVerificationsTable.id,
        userId: creatorVerificationsTable.userId,
        badgeType: creatorVerificationsTable.badgeType,
        status: creatorVerificationsTable.status,
        verifiedAt: creatorVerificationsTable.verifiedAt,
        revokedAt: creatorVerificationsTable.revokedAt,
        reason: creatorVerificationsTable.reason,
        username: usersTable.username,
        avatar: usersTable.avatar,
      })
      .from(creatorVerificationsTable)
      .innerJoin(usersTable, eq(creatorVerificationsTable.userId, usersTable.id))
      .orderBy(desc(creatorVerificationsTable.verifiedAt));
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Owner: assign a badge ─────────────────────────────────────────────────────

router.post("/verifications", authenticate, requireRole("owner"), async (req, res) => {
  try {
    const ownerId = req.user!.userId;
    const { userId, badgeType, reason } = req.body;

    if (!userId || !badgeType) {
      res.status(400).json({ error: "userId and badgeType are required" });
      return;
    }
    if (!VALID_MANUAL_BADGES.includes(badgeType)) {
      res.status(400).json({ error: `badgeType must be one of: ${VALID_MANUAL_BADGES.join(", ")}` });
      return;
    }

    const [target] = await db.select({ id: usersTable.id, username: usersTable.username })
      .from(usersTable).where(eq(usersTable.id, userId));
    if (!target) { res.status(404).json({ error: "User not found" }); return; }

    // Check if they already have this badge (active)
    const [existing] = await db
      .select({ id: creatorVerificationsTable.id })
      .from(creatorVerificationsTable)
      .where(and(
        eq(creatorVerificationsTable.userId, userId),
        eq(creatorVerificationsTable.badgeType, badgeType),
        eq(creatorVerificationsTable.status, "active"),
      ));
    if (existing) {
      res.status(409).json({ error: "User already has this badge" });
      return;
    }

    const [ver] = await db.insert(creatorVerificationsTable)
      .values({ userId, badgeType, verifiedBy: ownerId, reason: reason ?? null })
      .returning();

    await db.insert(verificationHistoryTable).values({
      verificationId: ver.id,
      userId,
      action: "granted",
      performedBy: ownerId,
      badgeType,
      note: reason ?? null,
    });

    await syncUserBadge(userId);

    res.status(201).json(ver);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Owner: revoke a badge ─────────────────────────────────────────────────────

router.patch("/verifications/:id/revoke", authenticate, requireRole("owner"), async (req, res) => {
  try {
    const ownerId = req.user!.userId;
    const { reason } = req.body;
    const { id } = req.params;

    const [ver] = await db.select().from(creatorVerificationsTable)
      .where(eq(creatorVerificationsTable.id, id));
    if (!ver) { res.status(404).json({ error: "Verification not found" }); return; }
    if (ver.status === "revoked") {
      res.status(409).json({ error: "Already revoked" });
      return;
    }
    if (ver.badgeType === "sulthan") {
      res.status(403).json({ error: "Sulthan badge is automatic and cannot be manually revoked" });
      return;
    }

    await db.update(creatorVerificationsTable)
      .set({ status: "revoked", revokedAt: new Date(), revokedBy: ownerId })
      .where(eq(creatorVerificationsTable.id, id));

    await db.insert(verificationHistoryTable).values({
      verificationId: id,
      userId: ver.userId,
      action: "revoked",
      performedBy: ownerId,
      badgeType: ver.badgeType,
      note: reason ?? null,
    });

    await syncUserBadge(ver.userId);

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Owner: verification history ───────────────────────────────────────────────

router.get("/verifications/history", authenticate, requireRole("owner"), async (req, res) => {
  try {
    const limit = Math.min(100, parseInt(String(req.query.limit ?? "50")));
    const rows = await db
      .select({
        id: verificationHistoryTable.id,
        action: verificationHistoryTable.action,
        badgeType: verificationHistoryTable.badgeType,
        note: verificationHistoryTable.note,
        createdAt: verificationHistoryTable.createdAt,
        targetUsername: usersTable.username,
        targetId: verificationHistoryTable.userId,
      })
      .from(verificationHistoryTable)
      .innerJoin(usersTable, eq(verificationHistoryTable.userId, usersTable.id))
      .orderBy(desc(verificationHistoryTable.createdAt))
      .limit(limit);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Public: search users for verification panel ───────────────────────────────

router.get("/verifications/search-users", authenticate, requireRole("admin"), async (req, res) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (!q) { res.json([]); return; }
    const users = await db
      .select({
        id: usersTable.id,
        username: usersTable.username,
        avatar: usersTable.avatar,
        role: usersTable.role,
        verificationBadge: usersTable.verificationBadge,
      })
      .from(usersTable)
      .where(eq(usersTable.username, q))
      .limit(10);
    res.json(users);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export { syncUserBadge };
export default router;
