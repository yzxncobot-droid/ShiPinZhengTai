import { Router } from "express";
import crypto from "node:crypto";
import { db } from "@workspace/db";
import {
  topupsTable, usersTable,
  notificationsTable, paymentProofsTable,
  settingsTable,
} from "@workspace/db";
import { eq, and, desc, count, or, sql } from "drizzle-orm";
import { authenticate, requireRole } from "../middlewares/auth";
import { qrisRateLimit } from "../middlewares/rate-limit";
import { invalidateUserCache, invalidateCache, keys } from "../lib/redis";
import { logger } from "../lib/logger";
import {
  getGatewayState,
  gatewayErrorCode,
  createQrisPayment,
  buatqrisWebhookUrl,
  verifyWebhookSignature,
  isWebhookConfigured,
} from "../lib/buatqris";
import {
  creditVerifiedTopup,
  processBuatQrisWebhook,
  syncBuatQrisStatus,
} from "../lib/topup-verification";

// ── Fee config helpers ──────────────────────────────────────────────────────
async function getFeeConfig(): Promise<{ type: string; rate: number }> {
  const [s] = await db.select({
    type: settingsTable.automaticFeeType,
    rate: settingsTable.automaticFeeRate,
  }).from(settingsTable).limit(1);
  return {
    type: s?.type ?? "percentage",
    rate: Number(s?.rate ?? 0),
  };
}

function computeFee(amount: number, feeType: string, feeRate: number): number {
  if (!feeRate || feeRate <= 0) return 0;
  if (feeType === "fixed") return Math.round(feeRate);
  return Math.round((amount * feeRate) / 100);
}

const router = Router();

const MIN_TOPUP = 100;
const MAX_TOPUP = 1_000_000;

function parseTopupAmount(value: unknown): number | null {
  const amount = Number(value);
  if (!Number.isInteger(amount) || amount < MIN_TOPUP || amount > MAX_TOPUP) return null;
  return amount;
}

function isPaidStatus(status: string): boolean {
  return status === "paid" || status === "confirmed";
}

// ── GET /topup/fee-config — automatic fee config from settings ──────────────
router.get("/topup/fee-config", async (_req, res) => {
  const fee = await getFeeConfig();
  res.json({
    automaticFeeType: fee.type,
    automaticFeeRate: fee.rate,
  });
});

// ── GET /payments/buatqris/health — diagnostic config status (admin/dev) ──────
// Safe status flags — NEVER returns secret values. Used to verify the
// BuatQris env vars are wired up without exposing them.
router.get("/payments/buatqris/health", authenticate, requireRole("admin", "owner"), async (_req, res) => {
  res.json({
    configured: getGatewayState() === "CONNECTED" && isWebhookConfigured(),
    account_id_configured: !!process.env.BUATQRIS_ACCOUNT_ID?.trim(),
    secret_token_configured: !!process.env.BUATQRIS_SECRET_TOKEN?.trim(),
    webhook_secret_configured: isWebhookConfigured(),
    callback_url: buatqrisWebhookUrl(),
  });
});

// ── GET /buatqris/config — BuatQris gateway config (admin) ───────────────────
// Shows the connection state, account ID, webhook secret (masked), and the
// auto-constructed callback URL. The secret token is NEVER returned.
router.get("/buatqris/config", authenticate, requireRole("admin", "owner"), async (_req, res) => {
  const state = getGatewayState();
  const webhookConfigured = isWebhookConfigured();
  const callbackUrl = buatqrisWebhookUrl();
  const accountId = process.env.BUATQRIS_ACCOUNT_ID?.trim() || null;
  // Mask the webhook secret: show only whether it is set, never the value.
  res.json({
    state,
    accountId,
    secretTokenConfigured: !!process.env.BUATQRIS_SECRET_TOKEN?.trim(),
    webhookSecretConfigured: webhookConfigured,
    callbackUrl,
  });
});

// ════════════════════════════════════════════════════════════════════════════
// AUTOMATIC PAYMENT — BuatQris
// ════════════════════════════════════════════════════════════════════════════

// ── POST /payments/buatqris/create — create an automatic QRIS via BuatQris ──
router.post("/payments/buatqris/create", authenticate, qrisRateLimit, async (req, res) => {
  const amount = parseTopupAmount(req.body?.amount);
  if (amount == null) {
    res.status(400).json({
      success: false,
      error: { code: "INVALID_AMOUNT", message: `Nominal harus bulat antara Rp ${MIN_TOPUP.toLocaleString("id-ID")} dan Rp ${MAX_TOPUP.toLocaleString("id-ID")}.` },
    });
    return;
  }
  if (getGatewayState() !== "CONNECTED") {
    res.status(503).json({
      success: false,
      error: { code: "NOT_CONFIGURED", message: "Gateway QRIS belum dikonfigurasi. Hubungi admin." },
    });
    return;
  }

  // Keep one active automatic top-up per user.
  const [existingPending] = await db.select().from(topupsTable)
    .where(and(
      eq(topupsTable.userId, req.user!.userId),
      eq(topupsTable.paymentMethod, "automatic"),
      eq(topupsTable.status, "pending"),
    ))
    .orderBy(desc(topupsTable.createdAt))
    .limit(1);
  if (existingPending) {
    if (existingPending.expiredAt && new Date(existingPending.expiredAt).getTime() <= Date.now()) {
      await db.update(topupsTable).set({ status: "expired", updatedAt: new Date() })
        .where(and(eq(topupsTable.id, existingPending.id), eq(topupsTable.status, "pending")));
    } else {
      res.status(409).json({
        error: "Anda masih memiliki top up otomatis yang aktif.",
        topupId: existingPending.id,
        orderId: existingPending.orderId,
        expiredAt: existingPending.expiredAt,
      });
      return;
    }
  }

  const orderId = `TOPUP-${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
  const description = `Top Up Wallet ${orderId}`;
  const [topup] = await db.insert(topupsTable).values({
    userId: req.user!.userId,
    amount,
    orderId,
    paymentMethod: "automatic",
    provider: "buatqris",
    gateway: "buatqris",
    description,
    status: "pending",
    expiredAt: new Date(Date.now() + 15 * 60 * 1000),
  }).returning();

  try {
    const fee = await getFeeConfig();
    const serviceFee = computeFee(amount, fee.type, fee.rate);

    // Generate a dynamic QRIS via BuatQris. The secret token stays server-side.
    const qris = await createQrisPayment({ orderId, amount });

    const [updated] = await db.update(topupsTable).set({
      qrCodeUrl: qris.qrUrl ?? qris.qrisImage,
      qrisString: null,
      paymentLink: qris.paymentUrl,
      providerTransactionId: qris.transactionId,
      gatewayReference: qris.transactionId,
      expiredAt: new Date(Date.now() + 15 * 60 * 1000),
      updatedAt: new Date(),
    }).where(eq(topupsTable.id, topup.id)).returning();

    logger.info(
      { topupId: topup.id, orderId, transactionId: qris.transactionId, userId: req.user!.userId, amount },
      "Automatic topup created (BuatQris)",
    );

    res.status(201).json({
      success: true,
      id: updated.id,
      orderId,
      amount,
      serviceFee,
      totalAmount: amount + serviceFee,
      feeType: fee.type,
      feeRate: fee.rate,
      status: "pending",
      paymentMethod: "automatic",
      provider: "buatqris",
      providerTransactionId: qris.transactionId,
      qrCodeUrl: updated.qrCodeUrl,
      paymentLink: qris.paymentUrl,
      expiredAt: updated.expiredAt,
    });
  } catch (err) {
    const code = gatewayErrorCode(err);
    // The detailed provider error is already logged inside createQrisPayment();
    // only a safe, generic message is returned to the client.
    logger.error(
      { topupId: topup.id, orderId, code, providerMessage: String((err as any)?.message ?? "").slice(0, 200) },
      "[BUATQRIS CREATE] route handler caught error",
    );
    await db.update(topupsTable).set({ status: "failed", updatedAt: new Date() })
      .where(eq(topupsTable.id, topup.id));
    const status = code === "NOT_CONFIGURED" ? 503 : 502;
    const safeMessage = code === "NOT_CONFIGURED"
      ? "Gateway QRIS belum dikonfigurasi. Hubungi admin."
      : "QRIS belum dapat dibuat. Silakan coba lagi.";
    res.status(status).json({
      success: false,
      error: { code, message: safeMessage },
    });
  }
});

// ── GET /topup/:id/status — status check with BuatQris sync fallback ────────
// The frontend polls this to reflect the current status. For automatic
// (buatqris) payments that are still pending, it also queries the BuatQris
// provider as a fallback — if the provider reports "success", the wallet is
// credited via creditVerifiedTopup() (the SAME single credit path used by the
// webhook). Polling never has its own credit logic.
router.get("/topup/:id/status", authenticate, qrisRateLimit, async (req, res) => {
  const id = String(req.params.id);
  const [topup] = await db.select().from(topupsTable)
    .where(and(eq(topupsTable.id, id), eq(topupsTable.userId, req.user!.userId))).limit(1);
  if (!topup) { res.status(404).json({ error: "Top-up not found" }); return; }

  if (isPaidStatus(topup.status)) {
    res.json({ ...topup, status: "paid", paid: true });
    return;
  }
  if (["expired", "failed", "cancelled", "rejected", "denied"].includes(topup.status)) {
    res.json({ ...topup, paid: false });
    return;
  }
  // Auto-expire if past the expiry time.
  if (topup.expiredAt && new Date(topup.expiredAt).getTime() <= Date.now()) {
    const [expired] = await db.update(topupsTable).set({ status: "expired", updatedAt: new Date() })
      .where(and(eq(topupsTable.id, id), eq(topupsTable.status, "pending"))).returning();
    res.json({ ...(expired ?? topup), paid: false });
    return;
  }

  // For automatic (buatqris) payments still pending, sync with the provider
  // as a fallback. If the provider reports success, creditVerifiedTopup()
  // is called (idempotent — safe even if the webhook already credited).
  if (topup.paymentMethod === "automatic" && topup.providerTransactionId) {
    try {
      const effectiveStatus = await syncBuatQrisStatus(topup);
      if (effectiveStatus === "paid") {
        res.json({ ...topup, status: "paid", paid: true });
        return;
      }
      if (effectiveStatus === "expired" || effectiveStatus === "failed") {
        res.json({ ...topup, status: effectiveStatus, paid: false });
        return;
      }
    } catch (err: any) {
      logger.warn({ topupId: id, error: err?.message }, "Status sync failed — returning DB status");
    }
  }

  const [latest] = await db.select().from(topupsTable).where(eq(topupsTable.id, id)).limit(1);
  res.json({
    ...(latest ?? topup),
    status: isPaidStatus(latest?.status ?? "pending") ? "paid" : latest?.status ?? "pending",
    paid: isPaidStatus(latest?.status ?? "pending"),
  });
});

// ── POST /topup/:id/confirm-paid — "Sudah Bayar" button (BuatQris only) ─────
// The user presses "Sudah Bayar" after paying the QRIS. This does NOT credit
// the wallet by itself — it checks the BuatQris provider for the actual
// transaction status. Only if the provider confirms "success" does it credit
// via creditVerifiedTopup(). If still pending, returns "awaiting_payment".
router.post("/topup/:id/confirm-paid", authenticate, qrisRateLimit, async (req, res) => {
  const id = String(req.params.id);
  const userId = req.user!.userId;

  const [topup] = await db.select().from(topupsTable)
    .where(eq(topupsTable.id, id)).limit(1);
  if (!topup) {
    res.status(404).json({ success: false, error: { code: "not_found", message: "Top-up tidak ditemukan." } });
    return;
  }

  // Ownership check — user cannot confirm another user's topup.
  if (topup.userId !== userId) {
    res.status(403).json({ success: false, error: { code: "forbidden", message: "Anda tidak memiliki akses ke top-up ini." } });
    return;
  }

  // Only automatic (buatqris) payments use this route.
  if (topup.paymentMethod !== "automatic") {
    res.status(400).json({ success: false, error: { code: "validation_error", message: "Tombol ini hanya untuk pembayaran otomatis (BuatQris)." } });
    return;
  }

  // Already paid — idempotent success.
  if (isPaidStatus(String(topup.status))) {
    res.json({ success: true, status: "paid" });
    return;
  }

  // Terminal states.
  if (["expired", "failed", "cancelled", "rejected", "denied"].includes(String(topup.status))) {
    res.json({ success: true, status: String(topup.status) });
    return;
  }

  // Check the BuatQris provider for the actual payment status.
  try {
    const effectiveStatus = await syncBuatQrisStatus(topup);

    if (effectiveStatus === "paid") {
      // Invalidate caches so the frontend sees the new balance.
      await invalidateUserCache(topup.userId).catch(() => {});
      await invalidateCache(keys.analytics("overview")).catch(() => {});
      res.json({ success: true, status: "paid" });
      return;
    }

    if (effectiveStatus === "expired") {
      res.json({ success: true, status: "expired" });
      return;
    }

    if (effectiveStatus === "failed") {
      res.json({ success: true, status: "failed" });
      return;
    }

    // Still pending — payment not detected yet.
    res.json({ success: true, status: "awaiting_payment" });
  } catch (err: any) {
    logger.error({ topupId: id, error: err?.message }, "confirm-paid: provider check failed");
    res.status(502).json({
      success: false,
      error: { code: "provider_error", message: "Gagal memeriksa status pembayaran. Silakan coba lagi." },
    });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// BuatQris WEBHOOK
// ════════════════════════════════════════════════════════════════════════════

// ── POST /webhooks/buatqris — BuatQris callback (public, signature-verified) ─
// This is the PRIMARY source of payment confirmation for automatic top-ups.
// The signature is verified using the RAW request body and
// BUATQRIS_WEBHOOK_SECRET (server-only). No crediting happens without a
// valid signature.
router.post("/webhooks/buatqris", async (req, res) => {
  const rawBody = (req as any).rawBody as Buffer | undefined;
  const signature = String(req.headers["x-buatqris-signature"] ?? "");

  if (!isWebhookConfigured()) {
    logger.error("BuatQris webhook: BUATQRIS_WEBHOOK_SECRET not configured — rejecting");
    res.status(503).json({ error: "Webhook secret is not configured." });
    return;
  }

  if (!rawBody || !verifyWebhookSignature(rawBody, signature)) {
    logger.warn("BuatQris webhook: invalid signature rejected");
    res.status(401).json({ error: "Invalid webhook signature" });
    return;
  }

  let payload: any;
  try {
    payload = req.body ?? {};
  } catch {
    res.status(400).json({ error: "Invalid payload" });
    return;
  }

  try {
    const result = await processBuatQrisWebhook(payload);
    res.status(result.httpStatus).json(result.body);
  } catch (err: any) {
    logger.error({ err: err?.message }, "BuatQris webhook: internal error");
    res.status(500).json({ error: "Internal processing error" });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// MANUAL PAYMENT
// ════════════════════════════════════════════════════════════════════════════

// ── POST /topup/manual — create a manual top-up (pending, no proof yet) ─────
router.post("/topup/manual", authenticate, qrisRateLimit, async (req, res) => {
  const amount = parseTopupAmount(req.body?.amount);
  if (amount == null) {
    res.status(400).json({
      error: `Nominal harus bulat antara Rp ${MIN_TOPUP.toLocaleString("id-ID")} dan Rp ${MAX_TOPUP.toLocaleString("id-ID")}.`,
    });
    return;
  }

  const [topup] = await db.insert(topupsTable).values({
    userId: req.user!.userId,
    amount,
    paymentMethod: "manual",
    gateway: "manual",
    status: "pending",
  }).returning();

  // Fetch the static QRIS image from settings so the frontend can display it.
  const [settings] = await db.select({ qrisImage: settingsTable.qrisImage })
    .from(settingsTable).limit(1);

  logger.info({ topupId: topup.id, userId: req.user!.userId, amount }, "Manual topup created (pending)");

  res.status(201).json({
    id: topup.id,
    amount,
    status: "pending",
    paymentMethod: "manual",
    manualQrisImageUrl: settings?.qrisImage ?? null,
  });
});

// ── POST /topup/:id/upload-proof — upload payment proof for manual top-up ───
// Accepts a proof_image_url (already uploaded via /api/upload/payment-proof)
// and attaches it to the pending manual top-up. Status stays "pending".
router.post("/topup/:id/upload-proof", authenticate, qrisRateLimit, async (req, res) => {
  const topupId = String(req.params.id);
  const userId = req.user!.userId;
  const proofImageUrl = String(req.body?.proofImageUrl ?? req.body?.paymentProof ?? "").trim();

  if (!proofImageUrl) {
    res.status(400).json({ error: "Bukti pembayaran wajib diunggah." });
    return;
  }

  const [topup] = await db.select().from(topupsTable)
    .where(and(eq(topupsTable.id, topupId), eq(topupsTable.userId, userId))).limit(1);
  if (!topup) { res.status(404).json({ error: "Top-up not found" }); return; }
  if (topup.paymentMethod !== "manual") {
    res.status(400).json({ error: "Endpoint ini hanya untuk top up manual." });
    return;
  }
  if (topup.status !== "pending") {
    res.status(400).json({ error: `Tidak dapat mengupload bukti: status "${topup.status}".` });
    return;
  }

  // Store the proof in a dedicated payment_proofs record.
  const [proof] = await db.insert(paymentProofsTable).values({
    userId,
    imageUrl: proofImageUrl,
    claimedAmount: String(topup.amount),
    status: "pending",
  }).returning();

  await db.update(topupsTable).set({
    paymentProof: proofImageUrl,
    paymentProofId: proof.id,
    updatedAt: new Date(),
  }).where(eq(topupsTable.id, topupId));

  logger.info({ topupId, userId, proofId: proof.id }, "Manual topup proof uploaded (pending)");

  res.json({
    id: topupId,
    status: "pending",
    message: "Pembayaran sedang diperiksa.",
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

  const [{ total }] = await db.select({ total: count() }).from(topupsTable).where(eq(topupsTable.userId, userId));
  const data = await db.select().from(topupsTable)
    .where(eq(topupsTable.userId, userId))
    .orderBy(desc(topupsTable.createdAt))
    .limit(limitNum)
    .offset(offset);

  res.json({ data, total: Number(total), page: pageNum, limit: limitNum });
});

// ════════════════════════════════════════════════════════════════════════════
// ADMIN DASHBOARD
// ════════════════════════════════════════════════════════════════════════════

// ── GET /topups/all — list all top-ups (admin/owner) with paymentMethod filter ─
router.get("/topups/all", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const { status, payment_method, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = parseInt(page) || 1;
  const limitNum = Math.min(parseInt(limit) || 20, 100);
  const offset = (pageNum - 1) * limitNum;

  const conditions: any[] = [];
  if (status) conditions.push(eq(topupsTable.status, status as any));
  if (payment_method) conditions.push(eq(topupsTable.paymentMethod, payment_method as any));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ total }] = await db.select({ total: count() }).from(topupsTable).where(where);

  const raw = await db.select().from(topupsTable)
    .where(where)
    .orderBy(desc(topupsTable.createdAt))
    .limit(limitNum)
    .offset(offset);

  const data = await Promise.all(raw.map(async (t: any) => {
    const [user] = await db.select({
      id: usersTable.id, username: usersTable.username, avatar: usersTable.avatar,
    }).from(usersTable).where(eq(usersTable.id, t.userId)).limit(1);
    return { ...t, user: user ?? null };
  }));

  res.json({ data, total: Number(total), page: pageNum, limit: limitNum });
});

// ── PATCH /topups/:id/confirm — approve manual top-up (admin/owner) ──────────
// Credits via the SINGLE credit path (creditVerifiedTopup). Idempotent —
// repeated clicks do not double-credit (advisory lock + duplicate guard).
router.patch("/topups/:id/confirm", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const id = req.params.id as string;
  const reviewerId = req.user!.userId;

  try {
    const [topup] = await db.select().from(topupsTable).where(eq(topupsTable.id, id)).limit(1);
    if (!topup) { res.status(404).json({ error: "Top-up not found" }); return; }

    // Only manual payments can be confirmed by admin. Automatic payments are
    // confirmed by the BuatQris webhook.
    if (topup.paymentMethod !== "manual") {
      res.status(400).json({ error: "Hanya pembayaran manual yang dapat dikonfirmasi admin." });
      return;
    }
    if (topup.status !== "pending" && topup.status !== "awaiting_manual_review") {
      res.status(400).json({ error: `Tidak dapat konfirmasi: status sudah "${topup.status}".` });
      return;
    }
    if (topup.amountMatchStatus === "mismatch") {
      res.status(400).json({ error: "Tidak dapat konfirmasi: nominal transfer tidak cocok." });
      return;
    }

    logger.info({ topupId: id, userId: topup.userId, amount: topup.amount, by: reviewerId }, "Admin confirm: crediting via creditVerifiedTopup");

    // Credit through the single credit path. Use a unique admin reference
    // so the duplicate-reference guard prevents double-crediting.
    const gatewayReference = `admin-${id}`;
    const result = await creditVerifiedTopup(id, gatewayReference);

    if (result.status !== "paid" && result.status !== "already_processed") {
      res.status(400).json({ error: `Gagal konfirmasi: credit status ${result.status}` });
      return;
    }

    // Record reviewer metadata + approve the payment proof.
    await db.update(topupsTable).set({
      reviewedBy: reviewerId,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(topupsTable.id, id));

    if (topup.paymentProofId) {
      await db.update(paymentProofsTable).set({
        status: "approved", reviewedBy: reviewerId, reviewedAt: new Date(), updatedAt: new Date(),
      }).where(eq(paymentProofsTable.id, topup.paymentProofId));
    }

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
    if (!topup) { res.status(404).json({ error: "Top-up not found" }); return; }
    if (topup.paymentMethod !== "manual") {
      res.status(400).json({ error: "Hanya pembayaran manual yang dapat ditolak admin." });
      return;
    }
    if (topup.status !== "pending" && topup.status !== "awaiting_manual_review") {
      res.status(400).json({ error: `Tidak dapat menolak: status sudah "${topup.status}".` });
      return;
    }

    const amountFormatted = topup.amount.toLocaleString("id-ID");
    let updated: typeof topup;
    await db.transaction(async (tx: any) => {
      const [result] = await tx.update(topupsTable)
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
        await tx.update(paymentProofsTable).set({
          status: "denied", reviewedBy: reviewerId, reviewedAt: new Date(), reviewNote: note ?? null, updatedAt: new Date(),
        }).where(eq(paymentProofsTable.id, topup.paymentProofId));
      }
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
