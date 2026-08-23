import crypto from "node:crypto";
import { logger } from "./logger";

const TEMANQRIS_BASE_URL = "https://temanqris.com/api/qris";

export type GatewayState = "CONNECTED" | "NOT_CONFIGURED" | "INVALID";

export interface TemanQrisPayment {
  orderId: string;
  amount: number;
  linkCode: string | null;
  qrImage: string | null;
  qrisString: string | null;
  paymentLink: string | null;
  expiresAt: Date | null;
  raw: unknown;
}

export interface TemanQrisOrder {
  orderId: string;
  amount: number | null;
  status: string;
  expiresAt: Date | null;
  raw: unknown;
}

function apiKey(): string | null {
  return process.env.TEMANQRIS_API_KEY?.trim() || null;
}

function webhookSecret(): string | null {
  return process.env.TEMANQRIS_WEBHOOK_SECRET?.trim() || null;
}

function gatewayError(message: string, code = "GATEWAY_ERROR"): Error {
  const error = new Error(message);
  (error as any).code = code;
  return error;
}

function asDate(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function payloadOf(body: any): any {
  return body?.data ?? body?.result ?? body;
}

function firstValue(source: any, names: string[]): unknown {
  for (const name of names) {
    if (source?.[name] != null) return source[name];
  }
  return undefined;
}

function errorCodeForStatus(status: number): string {
  if (status === 401 || status === 403) return "INVALID";
  if (status === 404) return "NOT_FOUND";
  return "GATEWAY_ERROR";
}

async function temanqrisRequest(
  path: string,
  method: "GET" | "POST",
  body?: Record<string, unknown>,
): Promise<any> {
  if (!apiKey()) throw gatewayError("TEMANQRIS_API_KEY is not configured", "NOT_CONFIGURED");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${TEMANQRIS_BASE_URL}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-API-Key": apiKey()!,
      },
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
      signal: controller.signal,
    });
    let responseBody: any = null;
    try {
      responseBody = await response.json();
    } catch {
      responseBody = null;
    }
    if (!response.ok) {
      throw gatewayError(
        `TemanQRIS request failed (${response.status})`,
        errorCodeForStatus(response.status),
      );
    }
    if (responseBody?.success === false || responseBody?.status === false) {
      throw gatewayError(
        String(responseBody?.message ?? "TemanQRIS rejected the request"),
      );
    }
    return responseBody;
  } finally {
    clearTimeout(timeout);
  }
}

function publicAppUrl(): string | null {
  const configured = process.env.TEMANQRIS_PUBLIC_URL?.trim() || process.env.PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const devDomain = process.env.REPLIT_DEV_DOMAIN?.trim();
  return devDomain ? `https://${devDomain}` : null;
}

export function temanqrisWebhookUrl(): string | null {
  const configured = process.env.TEMANQRIS_WEBHOOK_URL?.trim();
  if (configured) return configured;
  const base = publicAppUrl();
  return base ? `${base}/api/webhooks/temanqris` : null;
}

export function temanqrisCallbackUrl(topupId: string): string | null {
  const base = publicAppUrl();
  return base
    ? `${base}/topup?topup_id=${encodeURIComponent(topupId)}`
    : null;
}

export function getGatewayState(): GatewayState {
  return apiKey() ? "CONNECTED" : "NOT_CONFIGURED";
}

export async function createPaymentLink(input: {
  orderId: string;
  amount: number;
  returnUrl?: string;
}): Promise<TemanQrisPayment> {
  const webhookUrl = temanqrisWebhookUrl();
  const callbackUrl = input.returnUrl;
  // Official endpoint: POST /payment-link creates a hosted QRIS payment page
  // at https://temanqris.com/p/{link_code}. The API key stays server-side; the
  // frontend only receives the resulting hosted URL (never the API key).
  const body = await temanqrisRequest("/payment-link", "POST", {
    order_id: input.orderId,
    amount: input.amount,
    description: `Top Up Wallet ${input.orderId}`,
    ...(webhookUrl ? { webhook_url: webhookUrl } : {}),
    ...(callbackUrl ? { callback_url: callbackUrl } : {}),
  });
  const data = payloadOf(body);
  const paymentLinkData = data?.payment_link ?? data?.paymentLink ?? {};
  const orderId = String(
    firstValue(paymentLinkData, ["order_id", "orderId"])
      ?? firstValue(data, ["order_id", "orderId"])
      ?? input.orderId,
  );
  const amount = Number(
    firstValue(data, ["amount", "nominal"])
      ?? firstValue(paymentLinkData, ["amount", "nominal"])
      ?? input.amount,
  );
  const linkCode = String(firstValue(paymentLinkData, ["link_code", "linkCode"]) ?? "") || null;
  const qrImage = String(firstValue(data, ["qr_image", "qrImage", "qr_url"]) ?? "") || null;
  const qrisString = String(firstValue(data, ["qris_string", "qr_string", "qris", "qr"]) ?? "") || null;
  const rawPaymentLink = String(firstValue(paymentLinkData, ["url", "payment_url", "paymentLink"]) ?? "") || null;
  const paymentLink = rawPaymentLink
    ? rawPaymentLink.startsWith("http")
      ? rawPaymentLink
      : `https://temanqris.com${rawPaymentLink.startsWith("/") ? "" : "/"}${rawPaymentLink}`
    : linkCode
      ? `https://temanqris.com/p/${linkCode}`
      : null;
  const expiresAt = asDate(
    firstValue(data, ["expires_at", "expired_at", "expiresAt"])
      ?? firstValue(paymentLinkData, ["expires_at", "expired_at", "expiresAt"]),
  );

  if (!paymentLink) {
    throw gatewayError("TemanQRIS returned no payment link", "INVALID_RESPONSE");
  }

  return { orderId, amount, linkCode, qrImage, qrisString, paymentLink, expiresAt, raw: body };
}

export async function getOrder(orderId: string): Promise<TemanQrisOrder> {
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(orderId)) {
    throw gatewayError("Invalid TemanQRIS order ID", "INVALID_ORDER_ID");
  }
  const body = await temanqrisRequest(`/orders/${encodeURIComponent(orderId)}`, "GET");
  const payload = payloadOf(body);
  const data = payload?.order ?? payload;
  return {
    orderId: String(firstValue(data, ["order_id", "orderId"]) ?? orderId),
    amount: Number(firstValue(data, ["amount", "nominal"]) ?? NaN) || null,
    status: String(firstValue(data, ["status", "state"]) ?? "pending").toLowerCase(),
    expiresAt: asDate(firstValue(data, ["expires_at", "expired_at", "expiresAt"])),
    raw: body,
  };
}

/**
 * SECURITY WARNING: This function calls POST /orders/{id}/verify, which
 * performs MERCHANT CONFIRMATION on the TemanQRIS side. It can mark an order
 * as "paid" WITHOUT proof that the customer actually paid. It must NEVER be
 * called automatically based on `awaiting_confirmation`, the "Sudah Bayar"
 * button, or widget callbacks — doing so was the root cause of the free-saldo
 * bug. It is retained only for potential manual/admin use. The wallet credit
 * path is exclusively: valid `payment.confirmed` webhook → creditVerifiedTopup()
 * or read-only getOrder() reporting "paid" → finalizeVerifiedTopup().
 */
export async function verifyOrder(orderId: string): Promise<TemanQrisOrder> {
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(orderId)) {
    throw gatewayError("Invalid TemanQRIS order ID", "INVALID_ORDER_ID");
  }
  const body = await temanqrisRequest(`/orders/${encodeURIComponent(orderId)}/verify`, "POST");
  const payload = payloadOf(body);
  const data = payload?.order ?? payload;
  return {
    orderId: String(firstValue(data, ["order_id", "orderId"]) ?? orderId),
    amount: Number(firstValue(data, ["amount", "nominal"]) ?? NaN) || null,
    status: String(firstValue(data, ["status", "state"]) ?? "pending").toLowerCase(),
    expiresAt: asDate(firstValue(data, ["expires_at", "expired_at", "expiresAt"])),
    raw: body,
  };
}

// ── Generate Dynamic QRIS — POST /generate ─────────────────────────────────
export interface GeneratedQris {
  qrisString: string | null;
  qrImage: string | null;
  amount: number;
  fee: { type: string | null; value: number | null };
  expiresAt: Date | null;
  paymentLink: {
    id: number | null;
    linkCode: string | null;
    orderId: string | null;
    url: string | null;
    amount: number | null;
    merchantName: string | null;
    expiresAt: Date | null;
  };
  raw: unknown;
}

export async function generateQris(input: {
  amount: number;
  feeType?: string;
  feeValue?: number;
  qrisId?: number;
  orderId?: string;
  webhookUrl?: string;
  callbackUrl?: string;
}): Promise<GeneratedQris> {
  const body = await temanqrisRequest("/generate", "POST", {
    amount: input.amount,
    ...(input.feeType ? { fee_type: input.feeType } : {}),
    ...(input.feeValue != null ? { fee_value: input.feeValue } : {}),
    ...(input.qrisId != null ? { qris_id: input.qrisId } : {}),
    ...(input.orderId ? { order_id: input.orderId } : {}),
    ...(input.webhookUrl ? { webhook_url: input.webhookUrl } : {}),
    ...(input.callbackUrl ? { callback_url: input.callbackUrl } : {}),
  });
  const data = payloadOf(body);
  const pl = data?.payment_link ?? {};
  return {
    qrisString: String(firstValue(data, ["qris", "qris_string", "qr_string"]) ?? "") || null,
    qrImage: String(firstValue(data, ["qr_image", "qrImage"]) ?? "") || null,
    amount: Number(firstValue(data, ["amount", "nominal"]) ?? input.amount),
    fee: {
      type: String(firstValue(data?.fee, ["type", "fee_type"]) ?? input.feeType ?? "") || null,
      value: Number(firstValue(data?.fee, ["value", "fee_value"]) ?? input.feeValue ?? NaN) || null,
    },
    expiresAt: asDate(firstValue(data, ["expires_at", "expired_at", "expiresAt"])),
    paymentLink: {
      id: Number(firstValue(pl, ["id"]) ?? NaN) || null,
      linkCode: String(firstValue(pl, ["link_code", "linkCode"]) ?? "") || null,
      orderId: String(firstValue(pl, ["order_id", "orderId"]) ?? "") || null,
      url: String(firstValue(pl, ["url", "payment_url"]) ?? "") || null,
      amount: Number(firstValue(pl, ["amount", "nominal"]) ?? NaN) || null,
      merchantName: String(firstValue(pl, ["merchant_name", "merchantName"]) ?? "") || null,
      expiresAt: asDate(firstValue(pl, ["expires_at", "expired_at", "expiresAt"])),
    },
    raw: body,
  };
}

// ── Render QR Image — POST /render ──────────────────────────────────────────
export async function renderQr(input: {
  qrisString?: string;
  qrisDataId?: number;
}): Promise<{ qrImage: string | null; raw: unknown }> {
  const body = await temanqrisRequest("/render", "POST", {
    ...(input.qrisString ? { qris_string: input.qrisString } : {}),
    ...(input.qrisDataId != null ? { qris_data_id: input.qrisDataId } : {}),
  });
  const data = payloadOf(body);
  return {
    qrImage: String(firstValue(data, ["qr_image", "qrImage"]) ?? "") || null,
    raw: body,
  };
}

// ── List Payment Links — GET /payment-links ─────────────────────────────────
export async function listPaymentLinks(): Promise<{ paymentLinks: any[]; raw: unknown }> {
  const body = await temanqrisRequest("/payment-links", "GET");
  const data = payloadOf(body);
  const links = Array.isArray(data?.payment_links)
    ? data.payment_links
    : Array.isArray(data?.paymentLinks)
      ? data.paymentLinks
      : Array.isArray(data)
        ? data
        : [];
  return { paymentLinks: links, raw: body };
}

// ── List Orders — GET /orders?status=&limit=&offset= ────────────────────────
export async function listOrders(
  query: { status?: string; limit?: number; offset?: number } = {},
): Promise<{ orders: any[]; pagination: any; raw: unknown }> {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.limit != null) params.set("limit", String(query.limit));
  if (query.offset != null) params.set("offset", String(query.offset));
  const qs = params.toString();
  const body = await temanqrisRequest(`/orders${qs ? `?${qs}` : ""}`, "GET");
  const data = payloadOf(body);
  const orders = Array.isArray(data?.orders) ? data.orders : Array.isArray(data) ? data : [];
  const pagination = data?.pagination ?? null;
  return { orders, pagination, raw: body };
}

// ── API Usage — GET /usage ──────────────────────────────────────────────────
export async function getUsage(): Promise<{ usage: any; raw: unknown }> {
  const body = await temanqrisRequest("/usage", "GET");
  const data = payloadOf(body);
  return { usage: data?.usage ?? data, raw: body };
}

// ── My QRIS — GET /my-qris ──────────────────────────────────────────────────
export async function getMyQris(): Promise<{ qris: any[]; raw: unknown }> {
  const body = await temanqrisRequest("/my-qris", "GET");
  const data = payloadOf(body);
  const qris = Array.isArray(data?.qris)
    ? data.qris
    : Array.isArray(data?.qris_data)
      ? data.qris_data
      : Array.isArray(data)
        ? data
        : [];
  return { qris, raw: body };
}

// ── Upload static QRIS — POST /upload ───────────────────────────────────────
export async function uploadQris(input: {
  qrisString: string;
  name?: string;
}): Promise<{ qris: any; raw: unknown }> {
  const body = await temanqrisRequest("/upload", "POST", {
    qris_string: input.qrisString,
    ...(input.name ? { name: input.name } : {}),
  });
  const data = payloadOf(body);
  return { qris: data?.qris ?? data?.qris_data ?? data, raw: body };
}

// ── Customer "Sudah Bayar" (public, no API key) — POST /api/pay/:link_code/confirm
// This is a TemanQRIS-hosted public endpoint (different base path /api/pay, not
// /api/qris). It marks an order as `awaiting_confirmation` — it is NOT proof of
// payment. We proxy it server-side so the API key never reaches the browser
// and to avoid cross-origin calls from the frontend.
export async function confirmCustomerPayment(linkCode: string): Promise<{
  success: boolean;
  orderId: string | null;
  status: string | null;
  raw: unknown;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(
      `https://temanqris.com/api/pay/${encodeURIComponent(linkCode)}/confirm`,
      { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal },
    );
    let responseBody: any = null;
    try { responseBody = await response.json(); } catch { responseBody = null; }
    if (!response.ok) {
      throw gatewayError(
        `TemanQRIS confirm failed (${response.status})`,
        errorCodeForStatus(response.status),
      );
    }
    const data = payloadOf(responseBody);
    return {
      success: Boolean(firstValue(responseBody, ["success"]) ?? firstValue(data, ["success"]) ?? true),
      orderId: String(firstValue(data, ["order_id", "orderId"]) ?? "") || null,
      status: String(firstValue(data, ["status", "state"]) ?? "awaiting_confirmation") || null,
      raw: responseBody,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function isWebhookConfigured(): boolean {
  return !!webhookSecret();
}

export function verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
  const secret = webhookSecret();
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const received = signature.trim().replace(/^sha256=/i, "");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const receivedBuffer = Buffer.from(received, "utf8");
  return expectedBuffer.length === receivedBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

export function gatewayErrorCode(error: unknown): string {
  const code = (error as any)?.code;
  if (code) return String(code);
  logger.warn({ error: (error as any)?.message ?? String(error) }, "TemanQRIS request failed");
  return "GATEWAY_ERROR";
}