import { Router } from "express";
import { authenticate, requireRole } from "../middlewares/auth";
import { logger } from "../lib/logger";
import {
  getGatewayState,
  gatewayErrorCode,
  getOrder,
  verifyOrder,
  generateQris,
  renderQr,
  listPaymentLinks,
  listOrders,
  getUsage,
  getMyQris,
  uploadQris,
  confirmCustomerPayment,
} from "../lib/temanqris";

const router = Router();

// ── POST /temanqris/pay/:linkCode/confirm — proxy the public customer "Sudah
// Bayar" endpoint. Public (no API key, no auth) so the customer's browser can
// trigger it. Marks the order as awaiting_confirmation — NOT proof of payment.
// Defined BEFORE the admin auth middleware below so it stays publicly callable.
router.post("/temanqris/pay/:linkCode/confirm", async (req, res) => {
  const linkCode = String(req.params.linkCode).trim();
  if (!linkCode) {
    res.status(400).json({ error: "link_code wajib diisi" });
    return;
  }
  try {
    const result = await confirmCustomerPayment(linkCode);
    res.json(result);
  } catch (err) {
    const code = gatewayErrorCode(err);
    const status = code === "NOT_FOUND" ? 404 : 502;
    res.status(status).json({ error: "Konfirmasi pembayaran gagal", code });
  }
});

// All management endpoints below require an authenticated admin/owner. The
// TemanQRIS API key stays server-side — the frontend never sees it.
router.use(authenticate, requireRole("admin", "owner"));

// ── GET /temanqris/gateway — connection status ──────────────────────────────
router.get("/temanqris/gateway", (_req, res) => {
  res.json({ state: getGatewayState() });
});

// ── GET /temanqris/my-qris — list saved static QRIS ──────────────────────────
router.get("/temanqris/my-qris", async (_req, res) => {
  try {
    const result = await getMyQris();
    res.json({ success: true, qris: result.qris });
  } catch (err) {
    res.status(502).json({ error: "Gagal mengambil QRIS", code: gatewayErrorCode(err) });
  }
});

// ── POST /temanqris/upload — upload a static QRIS string ─────────────────────
router.post("/temanqris/upload", async (req, res) => {
  const qrisString = String(req.body?.qris_string ?? req.body?.qrisString ?? "").trim();
  if (!qrisString) {
    res.status(400).json({ error: "qris_string wajib diisi" });
    return;
  }
  try {
    const result = await uploadQris({
      qrisString,
      name: req.body?.name ? String(req.body.name) : undefined,
    });
    res.json({ success: true, qris: result.qris });
  } catch (err) {
    res.status(502).json({ error: "Upload QRIS gagal", code: gatewayErrorCode(err) });
  }
});

// ── POST /temanqris/generate — generate a dynamic QRIS ───────────────────────
router.post("/temanqris/generate", async (req, res) => {
  const amount = Number(req.body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: "amount harus berupa angka positif" });
    return;
  }
  try {
    const result = await generateQris({
      amount,
      feeType: req.body?.fee_type ? String(req.body.fee_type) : undefined,
      feeValue: req.body?.fee_value != null ? Number(req.body.fee_value) : undefined,
      qrisId: req.body?.qris_id != null ? Number(req.body.qris_id) : undefined,
      orderId: req.body?.order_id ? String(req.body.order_id) : undefined,
      webhookUrl: req.body?.webhook_url ? String(req.body.webhook_url) : undefined,
      callbackUrl: req.body?.callback_url ? String(req.body.callback_url) : undefined,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(502).json({ error: "Generate QRIS gagal", code: gatewayErrorCode(err) });
  }
});

// ── POST /temanqris/render — render a QR image from string or saved id ───────
router.post("/temanqris/render", async (req, res) => {
  const qrisString = req.body?.qris_string ? String(req.body.qris_string) : undefined;
  const qrisDataId = req.body?.qris_data_id != null ? Number(req.body.qris_data_id) : undefined;
  if (!qrisString && qrisDataId == null) {
    res.status(400).json({ error: "Berikan qris_string atau qris_data_id" });
    return;
  }
  try {
    const result = await renderQr({ qrisString, qrisDataId });
    res.json({ success: true, qr_image: result.qrImage });
  } catch (err) {
    res.status(502).json({ error: "Render QR gagal", code: gatewayErrorCode(err) });
  }
});

// ── GET /temanqris/payment-links — list all payment links ────────────────────
router.get("/temanqris/payment-links", async (_req, res) => {
  try {
    const result = await listPaymentLinks();
    res.json({ success: true, payment_links: result.paymentLinks });
  } catch (err) {
    res.status(502).json({ error: "Gagal mengambil payment links", code: gatewayErrorCode(err) });
  }
});

// ── GET /temanqris/orders — list all orders (with optional filters) ──────────
router.get("/temanqris/orders", async (req, res) => {
  const { status, limit, offset } = req.query as Record<string, string>;
  try {
    const result = await listOrders({
      status: status || undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    res.json({ success: true, orders: result.orders, pagination: result.pagination });
  } catch (err) {
    res.status(502).json({ error: "Gagal mengambil daftar order", code: gatewayErrorCode(err) });
  }
});

// ── GET /temanqris/orders/:orderId — check a single order status ─────────────
router.get("/temanqris/orders/:orderId", async (req, res) => {
  try {
    const order = await getOrder(String(req.params.orderId));
    res.json({ success: true, order });
  } catch (err) {
    const code = gatewayErrorCode(err);
    const status = code === "NOT_FOUND" ? 404 : code === "INVALID_ORDER_ID" ? 400 : 502;
    res.status(status).json({ error: "Gagal mengecek status order", code });
  }
});

// ── POST /temanqris/orders/:orderId/verify — merchant-verify an order ────────
// SECURITY: this performs merchant confirmation on TemanQRIS and can mark an
// order as paid. Only call after funds are confirmed in your account.
router.post("/temanqris/orders/:orderId/verify", async (req, res) => {
  try {
    const order = await verifyOrder(String(req.params.orderId));
    logger.info({ orderId: req.params.orderId, status: order.status }, "TemanQRIS order verified (admin)");
    res.json({ success: true, order });
  } catch (err) {
    const code = gatewayErrorCode(err);
    const status = code === "NOT_FOUND" ? 404 : code === "INVALID_ORDER_ID" ? 400 : 502;
    res.status(status).json({ error: "Verifikasi order gagal", code });
  }
});

// ── GET /temanqris/usage — API usage / remaining limit ───────────────────────
router.get("/temanqris/usage", async (_req, res) => {
  try {
    const result = await getUsage();
    res.json({ success: true, usage: result.usage });
  } catch (err) {
    res.status(502).json({ error: "Gagal mengambil usage", code: gatewayErrorCode(err) });
  }
});

export default router;
