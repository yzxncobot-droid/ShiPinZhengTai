import { Router } from "express";
import { db } from "@workspace/db";
import {
  topupsTable,
  usersTable,
  notificationsTable,
  paymentProofsTable,
  settingsTable,
  auditLogsTable,
} from "@workspace/db";
import { eq, and, desc, count } from "drizzle-orm";
import { authenticate, requireRole } from "../middlewares/auth";
import { qrisRateLimit } from "../middlewares/rate-limit";
import { invalidateUserCache, invalidateCache, keys } from "../lib/redis";
import { logger } from "../lib/logger";
import { creditVerifiedTopup, isPaidStatus } from "../lib/topup-verification";

const router = Router();

const MIN_TOPUP = 100;
const MAX_TOPUP = 1_000_000;

function parseTopupAmount(value: unknown): number | null {
  const amount = Number(value);
  if (!Number.isInteger(amount) || amount < MIN_TOPUP || amount > MAX_TOPUP) return null;
  return amount;
}

// ── GET /settings/qris — get active QRIS image and payment instructions ─────
router.get("/settings/qris", async (_req, res) => {
  const [settings] = await db
    .select({ qrisImage: settingsTable.qrisImage })
    .from(settingsTable)
    .limit(1);

  res.json({
    qrisImage: settings?.qrisImage ?? null,
    minTopup: MIN_TOPUP,
    maxTopup: MAX_TOPUP,
  });
});

// ── GET /topup/fee-config — backward compat (always 0 fee for manual QRIS) ──
router.get("/topup/fee-config", async (_req, res) => {
  res.json({
    automaticFeeType: "fixed",
    automaticFeeRate: 0,
  });
});

// ════════════════════════════════════════════════════════════════════════════
// MANUAL QRIS PAYMENT SUBMISSION
// ════════════════════════════════════════════════════════════════════════════

// ── POST /topup/manual (and POST /topup) — submit manual top-up request ─────
const handleManualTopupSubmit = async (req: any, res: any) => {
  const userId = req.user!.userId;
  const amount = parseTopupAmount(req.body?.amount);
  if (amount == null) {
    res.status(400).json({
      error: `Nominal harus bulat antara Rp ${MIN_TOPUP.toLocaleString("id-ID")} dan Rp ${MAX_TOPUP.toLocaleString("id-ID")}.`,
    });
    return;
  }

  // Check for any active pending top-up for this user to prevent duplicate submissions
  const [existingPending] = await db
    .select()
    .from(topupsTable)
    .where(and(eq(topupsTable.userId, userId), eq(topupsTable.status, "pending")))
    .orderBy(desc(topupsTable.createdAt))
    .limit(1);

  if (existingPending) {
    res.status(409).json({
      error: "Anda masih memiliki permintaan top up yang menunggu verifikasi.",
      topupId: existingPending.id,
      status: "pending",
    });
    return;
  }

  const proofImageUrl = String(req.body?.proofImageUrl ?? req.body?.paymentProof ?? "").trim();

  // Create the manual topup record
  const [topup] = await db
    .insert(topupsTable)
    .values({
      userId,
      amount,
      paymentMethod: "manual",
      gateway: "manual",
      status: "pending",
      paymentProof: proofImageUrl || null,
      transferAmount: amount,
      amountMatchStatus: "match",
    })
    .returning();

  let proofRecordId: string | null = null;
  if (proofImageUrl) {
    const [proof] = await db
      .insert(paymentProofsTable)
      .values({
        userId,
        imageUrl: proofImageUrl,
        claimedAmount: String(amount),
        status: "pending",
      })
      .returning();
    proofRecordId = proof.id;

    await db
      .update(topupsTable)
      .set({
        paymentProofId: proof.id,
        updatedAt: new Date(),
      })
      .where(eq(topupsTable.id, topup.id));
  }

  // Fetch the active QRIS image from settings
  const [settings] = await db
    .select({ qrisImage: settingsTable.qrisImage })
    .from(settingsTable)
    .limit(1);

  logger.info(
    { topupId: topup.id, userId, amount, proofRecordId },
    "Manual topup created (pending)",
  );

  res.status(201).json({
    id: topup.id,
    amount,
    status: "pending",
    paymentMethod: "manual",
    paymentProof: proofImageUrl || null,
    manualQrisImageUrl: settings?.qrisImage ?? null,
    message: "Permintaan top up berhasil dibuat dan sedang menunggu verifikasi Admin/Owner.",
  });
};

router.post("/topup/manual", authenticate, qrisRateLimit, handleManualTopupSubmit);
router.post("/topup", authenticate, qrisRateLimit, handleManualTopupSubmit);

// ── POST /topup/:id/upload-proof — attach proof to existing pending top-up ──
router.post("/topup/:id/upload-proof", authenticate, qrisRateLimit, async (req, res) => {
  const topupId = String(req.params.id as string);
  const userId = req.user!.userId;
  const proofImageUrl = String(req.body?.proofImageUrl ?? req.body?.paymentProof ?? "").trim();

  if (!proofImageUrl) {
    res.status(400).json({ error: "Bukti pembayaran wajib diunggah." });
    return;
  }

  const [topup] = await db
    .select()
    .from(topupsTable)
    .where(and(eq(topupsTable.id, topupId), eq(topupsTable.userId, userId)))
    .limit(1);

  if (!topup) {
    res.status(404).json({ error: "Top-up not found" });
    return;
  }
  if (topup.status !== "pending") {
    res.status(400).json({ error: `Tidak dapat mengupload bukti: status "${topup.status}".` });
    return;
  }

  const [proof] = await db
    .insert(paymentProofsTable)
    .values({
      userId,
      imageUrl: proofImageUrl,
      claimedAmount: String(topup.amount),
      status: "pending",
    })
    .returning();

  await db
    .update(topupsTable)
    .set({
      paymentProof: proofImageUrl,
      paymentProofId: proof.id,
      updatedAt: new Date(),
    })
    .where(eq(topupsTable.id, topupId));

  logger.info({ topupId, userId, proofId: proof.id }, "Manual topup proof uploaded (pending)");

  res.json({
    id: topupId,
    status: "pending",
    message: "Bukti pembayaran berhasil diunggah. Menunggu verifikasi Admin/Owner.",
  });
});

// ── GET /topup/:id/status — check status of top-up ──────────────────────────
router.get("/topup/:id/status", authenticate, async (req, res) => {
  const id = String(req.params.id as string);
  const userId = req.user!.userId;

  const [topup] = await db
    .select()
    .from(topupsTable)
    .where(and(eq(topupsTable.id, id), eq(topupsTable.userId, userId)))
    .limit(1);

  if (!topup) {
    res.status(404).json({ error: "Top-up not found" });
    return;
  }

  const paid = isPaidStatus(topup.status);
  res.json({
    ...topup,
    status: paid ? "paid" : topup.status,
    paid,
  });
});

// ════════════════════════════════════════════════════════════════════════════
// USER TOP-UP HISTORY
// ════════════════════════════════════════════════════════════════════════════

// ── GET /topups — user's own top-up history ────────────────────────────────────
router.get("/topups", authenticate, async (req, res) => {
  const userId = req.user!.userId;
  const { page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = parseInt(page) || 1;
  const limitNum = Math.min(parseInt(limit) || 20, 100);
  const offset = (pageNum - 1) * limitNum;

  const [{ total }] = await db
    .select({ total: count() })
    .from(topupsTable)
    .where(eq(topupsTable.userId, userId));

  const data = await db
    .select()
    .from(topupsTable)
    .where(eq(topupsTable.userId, userId))
    .orderBy(desc(topupsTable.createdAt))
    .limit(limitNum)
    .offset(offset);

  res.json({ data, total: Number(total), page: pageNum, limit: limitNum });
});

// ════════════════════════════════════════════════════════════════════════════
// ADMIN / OWNER PAYMENT VERIFICATION DASHBOARD
// ════════════════════════════════════════════════════════════════════════════

// ── GET /topups/all — list all top-ups (admin/owner) ─────────────────────────
router.get("/topups/all", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const { status, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = parseInt(page) || 1;
  const limitNum = Math.min(parseInt(limit) || 20, 100);
  const offset = (pageNum - 1) * limitNum;

  const conditions: any[] = [];
  if (status && status !== "all") {
    conditions.push(eq(topupsTable.status, status as any));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ total }] = await db.select({ total: count() }).from(topupsTable).where(where);

  const raw = await db
    .select()
    .from(topupsTable)
    .where(where)
    .orderBy(desc(topupsTable.createdAt))
    .limit(limitNum)
    .offset(offset);

  const data = await Promise.all(
    raw.map(async (t: any) => {
      const [user] = await db
        .select({
          id: usersTable.id,
          username: usersTable.username,
          avatar: usersTable.avatar,
        })
        .from(usersTable)
        .where(eq(usersTable.id, t.userId))
        .limit(1);
      return { ...t, user: user ?? null };
    }),
  );

  res.json({ data, total: Number(total), page: pageNum, limit: limitNum });
});

// ── PATCH /topups/:id/confirm — approve manual top-up (admin/owner) ──────────
router.patch("/topups/:id/confirm", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const id = req.params.id as string;
  const reviewerId = req.user!.userId;

  try {
    const [topup] = await db.select().from(topupsTable).where(eq(topupsTable.id, id)).limit(1);
    if (!topup) {
      res.status(404).json({ error: "Top-up not found" });
      return;
    }

    if (topup.status !== "pending" && topup.status !== "awaiting_manual_review") {
      res.status(400).json({ error: `Tidak dapat konfirmasi: status sudah "${topup.status}".` });
      return;
    }

    logger.info(
      { topupId: id, userId: topup.userId, amount: topup.amount, by: reviewerId },
      "Admin confirm: crediting via creditVerifiedTopup",
    );

    const gatewayReference = `admin-${id}`;
    const result = await creditVerifiedTopup(id, gatewayReference);

    if (result.status !== "paid" && result.status !== "already_processed") {
      res.status(400).json({ error: `Gagal konfirmasi: credit status ${result.status}` });
      return;
    }

    // Record reviewer metadata + approve payment proof
    await db
      .update(topupsTable)
      .set({
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(topupsTable.id, id));

    if (topup.paymentProofId) {
      await db
        .update(paymentProofsTable)
        .set({
          status: "approved",
          reviewedBy: reviewerId,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(paymentProofsTable.id, topup.paymentProofId));
    }

    // Record in audit log
    await db.insert(auditLogsTable).values({
      userId: reviewerId,
      action: "topup_approved",
      entity: "topup",
      entityId: id,
      details: JSON.stringify({
        topupId: id,
        userId: topup.userId,
        amount: topup.amount,
        creditedBalance: result.newBalance,
      }),
    });

    await invalidateUserCache(topup.userId);
    await invalidateCache(keys.analytics("overview")).catch(() => {});

    const [updated] = await db.select().from(topupsTable).where(eq(topupsTable.id, id)).limit(1);
    logger.info({ topupId: id, by: reviewerId }, "Admin confirm: success");
    res.json(updated);
  } catch (err: any) {
    logger.error({ err: err?.message, stack: err?.stack, id }, "Topup confirm failed");
    res.status(500).json({ error: `Gagal konfirmasi: ${err?.message ?? "Unknown error"}` });
  }
});

// ── PATCH /topups/:id/deny — reject manual top-up (admin/owner) ──────────────
router.patch("/topups/:id/deny", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const id = req.params.id as string;
  const reviewerId = req.user!.userId;
  const { note } = req.body;

  try {
    const [topup] = await db.select().from(topupsTable).where(eq(topupsTable.id, id)).limit(1);
    if (!topup) {
      res.status(404).json({ error: "Top-up not found" });
      return;
    }

    if (topup.status !== "pending" && topup.status !== "awaiting_manual_review") {
      res.status(400).json({ error: `Tidak dapat menolak: status sudah "${topup.status}".` });
      return;
    }

    const amountFormatted = topup.amount.toLocaleString("id-ID");
    let updated: typeof topup;
    await db.transaction(async (tx: any) => {
      const [result] = await tx
        .update(topupsTable)
        .set({
          status: "rejected",
          reviewedBy: reviewerId,
          reviewedAt: new Date(),
          reviewNote: note ?? null,
          updatedAt: new Date(),
        })
        .where(eq(topupsTable.id, id))
        .returning();
      updated = result;

      await tx.insert(notificationsTable).values({
        userId: topup.userId,
        title: "Top Up Ditolak",
        message: `Top up sebesar Rp ${amountFormatted} ditolak.${note ? ` Alasan: ${note}` : " Hubungi admin untuk informasi lebih lanjut."}`,
        type: "warning",
        category: "payment",
        referenceType: "topup",
        referenceId: topup.id,
      });

      if (topup.paymentProofId) {
        await tx
          .update(paymentProofsTable)
          .set({
            status: "denied",
            reviewedBy: reviewerId,
            reviewedAt: new Date(),
            reviewNote: note ?? null,
            updatedAt: new Date(),
          })
          .where(eq(paymentProofsTable.id, topup.paymentProofId));
      }

      await tx.insert(auditLogsTable).values({
        userId: reviewerId,
        action: "topup_rejected",
        entity: "topup",
        entityId: id,
        details: JSON.stringify({
          topupId: id,
          userId: topup.userId,
          amount: topup.amount,
          note: note ?? null,
        }),
      });
    });

    logger.info({ topupId: id, by: reviewerId }, "Topup rejected");
    res.json(updated!);
  } catch (err: any) {
    logger.error({ err: err?.message, stack: err?.stack, id }, "Topup deny failed");
    res.status(500).json({ error: `Gagal menolak: ${err?.message ?? "Unknown error"}` });
  }
});

// ── DELETE /topups/:id (admin/owner) ─────────────────────────────────────────
router.delete("/topups/:id", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const id = req.params.id as string;
  await db.delete(topupsTable).where(eq(topupsTable.id, id));
  res.json({ message: "Deleted" });
});

export default router;
