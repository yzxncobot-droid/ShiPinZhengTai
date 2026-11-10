import { Router } from "express";
import { db } from "@workspace/db";
import {
  usersTable,
  creatorVerificationsTable,
  verificationHistoryTable,
  creatorVerificationApplicationsTable,
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
  const best = active.sort((a: any, b: any) => (priority[b.badgeType] ?? 0) - (priority[a.badgeType] ?? 0))[0];
  await db.update(usersTable)
    .set({ verificationBadge: best?.badgeType ?? null, updatedAt: new Date() })
    .where(eq(usersTable.id, userId));
}

// ── Public: get a user's active badges ───────────────────────────────────────

router.get("/verifications/user/:userId", async (req, res) => {
  try {
    const { userId  } = req.params as { userId: string };
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
    const { id  } = req.params as { id: string };

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

// ── User: submit verified creator application ─────────────────────────────

router.post("/creator-verifications/apply", authenticate, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const { channelName, category, socialLinks, portfolioUrl, description } = req.body;

    if (!channelName || !channelName.trim()) {
      res.status(400).json({ error: "Nama channel/kreator wajib diisi" });
      return;
    }

    // Check if there is already a pending application
    const [pending] = await db
      .select({ id: creatorVerificationApplicationsTable.id })
      .from(creatorVerificationApplicationsTable)
      .where(and(
        eq(creatorVerificationApplicationsTable.userId, userId),
        eq(creatorVerificationApplicationsTable.status, "pending"),
      ))
      .limit(1);

    if (pending) {
      res.status(409).json({ error: "Anda sudah memiliki pengajuan verifikasi yang sedang diproses" });
      return;
    }

    const [app] = await db
      .insert(creatorVerificationApplicationsTable)
      .values({
        userId,
        channelName: channelName.trim(),
        category: category?.trim() || null,
        socialLinks: socialLinks?.trim() || null,
        portfolioUrl: portfolioUrl?.trim() || null,
        description: description?.trim() || null,
        status: "pending",
      })
      .returning();

    res.status(201).json(app);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── User: get my latest application status ──────────────────────────────────

router.get("/creator-verifications/my-application", authenticate, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const [app] = await db
      .select()
      .from(creatorVerificationApplicationsTable)
      .where(eq(creatorVerificationApplicationsTable.userId, userId))
      .orderBy(desc(creatorVerificationApplicationsTable.createdAt))
      .limit(1);

    res.json(app || null);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: list all applications ────────────────────────────────────────────

router.get("/admin/creator-verifications", authenticate, requireRole("admin"), async (req, res) => {
  try {
    const rows = await db
      .select({
        id: creatorVerificationApplicationsTable.id,
        userId: creatorVerificationApplicationsTable.userId,
        channelName: creatorVerificationApplicationsTable.channelName,
        category: creatorVerificationApplicationsTable.category,
        socialLinks: creatorVerificationApplicationsTable.socialLinks,
        portfolioUrl: creatorVerificationApplicationsTable.portfolioUrl,
        description: creatorVerificationApplicationsTable.description,
        status: creatorVerificationApplicationsTable.status,
        rejectionReason: creatorVerificationApplicationsTable.rejectionReason,
        reviewedAt: creatorVerificationApplicationsTable.reviewedAt,
        createdAt: creatorVerificationApplicationsTable.createdAt,
        username: usersTable.username,
        avatar: usersTable.avatar,
        verifiedCreator: usersTable.verifiedCreator,
      })
      .from(creatorVerificationApplicationsTable)
      .innerJoin(usersTable, eq(creatorVerificationApplicationsTable.userId, usersTable.id))
      .orderBy(desc(creatorVerificationApplicationsTable.createdAt));

    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: review application (approve or reject) ───────────────────────────

router.patch("/admin/creator-verifications/:id", authenticate, requireRole("admin"), async (req, res) => {
  try {
    const adminId = req.user!.userId;
    const { id } = req.params as { id: string };
    const { status, rejectionReason } = req.body;

    if (!["approved", "rejected"].includes(status)) {
      res.status(400).json({ error: "Status harus 'approved' atau 'rejected'" });
      return;
    }

    const [app] = await db
      .select()
      .from(creatorVerificationApplicationsTable)
      .where(eq(creatorVerificationApplicationsTable.id, id))
      .limit(1);

    if (!app) {
      res.status(404).json({ error: "Pengajuan tidak ditemukan" });
      return;
    }

    const [updated] = await db
      .update(creatorVerificationApplicationsTable)
      .set({
        status,
        rejectionReason: status === "rejected" ? (rejectionReason || null) : null,
        reviewedBy: adminId,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(creatorVerificationApplicationsTable.id, id))
      .returning();

    if (status === "approved") {
      // Grant Verified Creator status & Blue badge
      await db.update(usersTable)
        .set({
          verifiedCreator: true,
          verificationBadge: "blue",
          updatedAt: new Date(),
        })
        .where(eq(usersTable.id, app.userId));

      // Also ensure creator_verifications record exists
      const [existingBadge] = await db
        .select({ id: creatorVerificationsTable.id })
        .from(creatorVerificationsTable)
        .where(and(
          eq(creatorVerificationsTable.userId, app.userId),
          eq(creatorVerificationsTable.badgeType, "blue"),
          eq(creatorVerificationsTable.status, "active"),
        ));

      if (!existingBadge) {
        const [ver] = await db.insert(creatorVerificationsTable)
          .values({
            userId: app.userId,
            badgeType: "blue",
            verifiedBy: adminId,
            reason: "Verified Creator Application Approved",
          })
          .returning();

        await db.insert(verificationHistoryTable).values({
          verificationId: ver.id,
          userId: app.userId,
          action: "granted",
          performedBy: adminId,
          badgeType: "blue",
          note: "Verified Creator Application Approved",
        });
      }
    } else if (status === "rejected") {
      // If rejected, does not grant badge
    }

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: revoke verified creator status ────────────────────────────────────

router.post("/admin/creator-verifications/revoke/:userId", authenticate, requireRole("admin"), async (req, res) => {
  try {
    const adminId = req.user!.userId;
    const { userId } = req.params as { userId: string };
    const { reason } = req.body;

    await db.update(usersTable)
      .set({
        verifiedCreator: false,
        verificationBadge: null,
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, userId));

    await db.update(creatorVerificationsTable)
      .set({
        status: "revoked",
        revokedAt: new Date(),
        revokedBy: adminId,
        reason: reason || "Revoked by admin",
      })
      .where(and(
        eq(creatorVerificationsTable.userId, userId),
        eq(creatorVerificationsTable.status, "active"),
      ));

    await db.insert(verificationHistoryTable).values({
      userId,
      action: "revoked",
      performedBy: adminId,
      badgeType: "blue",
      note: reason || "Verified Creator status revoked",
    });

    res.json({ success: true, message: "Status Verified Creator berhasil dicabut" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export { syncUserBadge };
export default router;
