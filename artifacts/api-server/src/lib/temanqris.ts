import crypto from "node:crypto";
import { logger } from "./logger";

const TEMANQRIS_BASE_URL = "https://temanqris.com/api/qris";

export type GatewayState = "CONNECTED" | "NOT_CONFIGURED" | "INVALID";

export interface TemanQrisPayment {
  orderId: string;
  amount: number;
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
  title: string | null;
  description: string | null;
  isPaid: boolean | null;
  paidAt: Date | null;
  createdAt: Date | null;
  linkCode: string | null;
  confirmedBy: string | null;
  raw: unknown;
}

export interface TemanQrisOrderList {
  orders: TemanQrisOrder[];
  pagination: { limit: number; offset: number; total: number | null } | null;
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
  // TemanQRIS nests results under `order` (GET/verify/cancel) or exposes
  // fields at the top level (/generate). Fall back to the raw body.
  return body?.data ?? body?.result ?? body?.order ?? body;
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

/** Map a raw TemanQRIS order object to our normalized shape, covering the
 *  fields documented for GET /orders/:orderId, GET /orders, POST .../verify
 *  and the webhook `data` payload. */
function mapOrder(data: any, raw: unknown, fallbackOrderId: string, fallbackStatus = "pending"): TemanQrisOrder {
  const strOrNull = (v: unknown) => (v != null ? String(v) : null);
  return {
    orderId: String(firstValue(data, ["order_id", "orderId"]) ?? fallbackOrderId),
    amount: Number(firstValue(data, ["amount", "nominal"]) ?? NaN) || null,
    status: String(firstValue(data, ["status", "state"]) ?? fallbackStatus).toLowerCase(),
    expiresAt: asDate(firstValue(data, ["expires_at", "expired_at", "expiresAt"])),
    title: strOrNull(firstValue(data, ["title"])),
    description: strOrNull(firstValue(data, ["description"])),
    isPaid: firstValue(data, ["is_paid", "isPaid"]) != null
      ? Boolean(firstValue(data, ["is_paid", "isPaid"]))
      : null,
    paidAt: asDate(firstValue(data, ["paid_at", "paidAt"])),
    createdAt: asDate(firstValue(data, ["created_at", "createdAt"])),
    linkCode: strOrNull(firstValue(data, ["link_code", "linkCode"])),
    confirmedBy: strOrNull(firstValue(data, ["confirmed_by", "confirmedBy"])),
    raw,
  };
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

export function getGatewayState(): GatewayState {
  return apiKey() ? "CONNECTED" : "NOT_CONFIGURED";
}

export async function createPaymentLink(input: {
  orderId: string;
  amount: number;
}): Promise<TemanQrisPayment> {
  const webhookUrl = temanqrisWebhookUrl();
  const callbackUrl = publicAppUrl()
    ? `${publicAppUrl()}/topup?order_id=${encodeURIComponent(input.orderId)}`
    : undefined;
  // POST /generate returns the renderable QR image (base64 PNG), the raw QRIS
  // string, and a shareable payment_link — everything needed to render the
  // QR inline. (POST /payment-link only returns a hosted link, no QR image.)
  const body = await temanqrisRequest("/generate", "POST", {
    amount: input.amount,
    order_id: input.orderId,
    description: `Top up saldo Rp ${input.amount.toLocaleString("id-ID")}`,
    ...(webhookUrl ? { webhook_url: webhookUrl } : {}),
    ...(callbackUrl ? { callback_url: callbackUrl } : {}),
  });
  const data = payloadOf(body);
  const link = data?.payment_link;
  const orderId = String(link?.order_id ?? data?.order_id ?? input.orderId);
  const amount = Number(data?.amount ?? link?.amount ?? input.amount);
  const qrImage = String(data?.qr_image ?? "") || null;
  const qrisString = String(data?.qris ?? data?.qris_string ?? "") || null;
  const linkUrl = link?.url ? (String(link.url).startsWith("http") ? String(link.url) : `https://temanqris.com${link.url}`) : null;
  const expiresAt = asDate(data?.expires_at ?? link?.expires_at);

  if (!linkUrl && !qrImage && !qrisString) {
    throw gatewayError("TemanQRIS returned no payment link or QRIS payload", "INVALID_RESPONSE");
  }

  return { orderId, amount, qrImage, qrisString, paymentLink: linkUrl, expiresAt, raw: body };
}

export async function getOrder(orderId: string): Promise<TemanQrisOrder> {
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(orderId)) {
    throw gatewayError("Invalid TemanQRIS order ID", "INVALID_ORDER_ID");
  }
  const body = await temanqrisRequest(`/orders/${encodeURIComponent(orderId)}`, "GET");
  return mapOrder(payloadOf(body), body, orderId);
}

/** Verify Order (Merchant) — POST /orders/:orderId/verify marks an order as
 *  paid. Optional `payer_name` / `payer_note` are forwarded to TemanQRIS. */
export async function verifyOrder(
  orderId: string,
  options?: { payerName?: string; payerNote?: string },
): Promise<TemanQrisOrder> {
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(orderId)) {
    throw gatewayError("Invalid TemanQRIS order ID", "INVALID_ORDER_ID");
  }
  const body = await temanqrisRequest(
    `/orders/${encodeURIComponent(orderId)}/verify`,
    "POST",
    {
      ...(options?.payerName ? { payer_name: options.payerName } : {}),
      ...(options?.payerNote ? { payer_note: options.payerNote } : {}),
    },
  );
  return mapOrder(payloadOf(body), body, orderId);
}

export async function cancelOrder(orderId: string): Promise<TemanQrisOrder> {
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(orderId)) {
    throw gatewayError("Invalid TemanQRIS order ID", "INVALID_ORDER_ID");
  }
  const body = await temanqrisRequest(`/orders/${encodeURIComponent(orderId)}/cancel`, "POST");
  return mapOrder(payloadOf(body), body, orderId, "cancelled");
}

/** List all orders with pagination — GET /orders?status=&limit=&offset= */
export async function listOrders(options?: {
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<TemanQrisOrderList> {
  const params = new URLSearchParams();
  if (options?.status) params.set("status", options.status);
  if (options?.limit != null) params.set("limit", String(options.limit));
  if (options?.offset != null) params.set("offset", String(options.offset));
  const query = params.toString() ? `?${params.toString()}` : "";
  const body = await temanqrisRequest(`/orders${query}`, "GET");
  const data = payloadOf(body);
  const rawOrders = firstValue(data, ["orders", "data", "results", "items"]);
  const orders = Array.isArray(rawOrders) ? rawOrders : [];
  const pg = data?.pagination ?? data?.meta ?? null;
  return {
    orders: orders.map((o: any) => mapOrder(o, o, String(firstValue(o, ["order_id", "orderId"]) ?? ""))),
    pagination: pg
      ? {
          limit: Number(firstValue(pg, ["limit", "per_page"]) ?? options?.limit ?? 20) || 20,
          offset: Number(firstValue(pg, ["offset", "skip"]) ?? options?.offset ?? 0) || 0,
          total: firstValue(pg, ["total", "count"]) != null
            ? Number(firstValue(pg, ["total", "count"]))
            : null,
        }
      : null,
    raw: body,
  };
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
