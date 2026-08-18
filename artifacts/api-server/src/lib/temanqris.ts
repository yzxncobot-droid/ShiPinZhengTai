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
  const body = await temanqrisRequest("/payment-link", "POST", {
    order_id: input.orderId,
    amount: input.amount,
    ...(webhookUrl ? { webhook_url: webhookUrl } : {}),
    ...(callbackUrl ? { callback_url: callbackUrl } : {}),
  });
  const data = payloadOf(body);
  const orderId = String(firstValue(data, ["order_id", "orderId"]) ?? input.orderId);
  const amount = Number(firstValue(data, ["amount", "nominal"]) ?? input.amount);
  const qrImage = String(firstValue(data, ["qr_image", "qrImage", "qr_url"]) ?? "") || null;
  const qrisString = String(firstValue(data, ["qris_string", "qr_string", "qr"]) ?? "") || null;
  const paymentLink = String(firstValue(data, ["payment_link", "paymentLink", "url"]) ?? "") || null;
  const expiresAt = asDate(firstValue(data, ["expires_at", "expired_at", "expiresAt"]));

  if (!paymentLink && !qrImage && !qrisString) {
    throw gatewayError("TemanQRIS returned no payment link or QRIS payload", "INVALID_RESPONSE");
  }

  return { orderId, amount, qrImage, qrisString, paymentLink, expiresAt, raw: body };
}

export async function getOrder(orderId: string): Promise<TemanQrisOrder> {
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(orderId)) {
    throw gatewayError("Invalid TemanQRIS order ID", "INVALID_ORDER_ID");
  }
  const body = await temanqrisRequest(`/orders/${encodeURIComponent(orderId)}`, "GET");
  const data = payloadOf(body);
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
  const data = payloadOf(body);
  return {
    orderId: String(firstValue(data, ["order_id", "orderId"]) ?? orderId),
    amount: Number(firstValue(data, ["amount", "nominal"]) ?? NaN) || null,
    status: String(firstValue(data, ["status", "state"]) ?? "pending").toLowerCase(),
    expiresAt: asDate(firstValue(data, ["expires_at", "expired_at", "expiresAt"])),
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