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