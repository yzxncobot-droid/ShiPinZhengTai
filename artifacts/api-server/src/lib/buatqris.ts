import crypto from "node:crypto";
import { logger } from "./logger";

/**
 * BuatQris Open API client.
 *
 * Base API: https://api.buatqris.site
 *
 * The secret token (BUATQRIS_SECRET_TOKEN) and webhook secret
 * (BUATQRIS_WEBHOOK_SECRET) are SERVER-ONLY — they are never sent to the
 * frontend under any circumstance.
 */

const BUATQRIS_BASE_URL = "https://api.buatqris.site";

export type GatewayState = "CONNECTED" | "NOT_CONFIGURED";

export interface BuatQrisPayment {
  transactionId: string | null;
  qrUrl: string | null;
  qrisImage: string | null;
  paymentUrl: string | null;
  amount: number;
  totalAmount: number | null;
  status: string | null;
  raw: unknown;
}

function accountId(): string | null {
  return process.env.BUATQRIS_ACCOUNT_ID?.trim() || null;
}

function secretToken(): string | null {
  return process.env.BUATQRIS_SECRET_TOKEN?.trim() || null;
}

function webhookSecret(): string | null {
  return process.env.BUATQRIS_WEBHOOK_SECRET?.trim() || null;
}

function gatewayError(message: string, code = "GATEWAY_ERROR"): Error {
  const error = new Error(message);
  (error as any).code = code;
  return error;
}

/**
 * Resolve the public base URL used to construct the webhook/callback URL.
 * Priority: PUBLIC_BASE_URL → BASE44_PUBLIC_HOST_SUFFIX → null.
 * Never hardcodes a domain.
 */
export function publicAppUrl(): string | null {
  const configured = process.env.PUBLIC_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const b44suffix = process.env.BASE44_PUBLIC_HOST_SUFFIX?.trim();
  if (b44suffix) return `https://3000-${b44suffix}`;
  return null;
}

/** The BuatQris webhook callback URL (transaction-specific, sent on create). */
export function buatqrisWebhookUrl(): string | null {
  const base = publicAppUrl();
  return base ? `${base}/api/webhooks/buatqris` : null;
}

export function getGatewayState(): GatewayState {
  return accountId() && secretToken() ? "CONNECTED" : "NOT_CONFIGURED";
}

export function isWebhookConfigured(): boolean {
  return !!webhookSecret();
}

/**
 * Create a dynamic QRIS via BuatQris.
 *
 * POST https://api.buatqris.site
 * form-urlencoded body:
 *   action=api_create_qris
 *   account_id=...
 *   secret_token=...
 *   amount=<amount>
 *   description=<order_id>
 *   qris_method=qris_two
 *   callback_url=<PUBLIC_CALLBACK_URL>
 */
export async function createQrisPayment(input: {
  orderId: string;
  amount: number;
}): Promise<BuatQrisPayment> {
  if (!accountId() || !secretToken()) {
    throw gatewayError("BUATQRIS_ACCOUNT_ID / BUATQRIS_SECRET_TOKEN is not configured", "NOT_CONFIGURED");
  }

  const callbackUrl = buatqrisWebhookUrl();
  if (!callbackUrl) {
    throw gatewayError("PUBLIC_BASE_URL is not configured — cannot build callback URL", "NOT_CONFIGURED");
  }

  const params = new URLSearchParams({
    action: "api_create_qris",
    account_id: accountId()!,
    secret_token: secretToken()!,
    amount: String(input.amount),
    description: input.orderId,
    qris_method: "qris_two",
    fee_by: "user",
    callback_url: callbackUrl,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(BUATQRIS_BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: params.toString(),
      signal: controller.signal,
    });

    let body: any = null;
    const text = await response.text();
    try {
      body = JSON.parse(text);
    } catch {
      body = { rawText: text };
    }

    if (!response.ok) {
      logger.error(
        { httpStatus: response.status, providerSuccess: false, providerError: text.slice(0, 200), orderId: input.orderId },
        "[BUATQRIS CREATE] HTTP error from provider",
      );
      throw gatewayError(`BuatQris request failed (HTTP ${response.status})`, "GATEWAY_ERROR");
    }

    // Response may be wrapped in data/result or flat.
    const data = body?.data ?? body?.result ?? body;

    // BuatQris returns HTTP 200 even on failure (e.g. invalid account_id /
    // secret_token, invalid amount). HTTP status alone is NOT enough — we must
    // inspect the provider's own success/status field and surface its error
    // message instead of throwing a generic "no transaction_id".
    const statusField = String(body?.status ?? data?.status ?? "").toLowerCase();
    const providerSuccess =
      body?.success !== false && !["failed", "error", "gagal"].includes(statusField);

    if (!providerSuccess) {
      const providerError = String(
        body?.message ?? data?.message ?? data?.qris_status ?? body?.error ?? "QRIS creation rejected by provider",
      ).trim();
      logger.error(
        { httpStatus: response.status, providerSuccess: false, providerError, orderId: input.orderId },
        "[BUATQRIS CREATE] provider returned failure",
      );
      throw gatewayError(providerError, "PROVIDER_ERROR");
    }

    const transactionId = String(
      data?.transaction_id ?? data?.transactionId ?? data?.trx_id ?? data?.id ?? "",
    ) || null;

    const qrUrl = String(data?.qr_url ?? data?.qrUrl ?? "") || null;
    const qrisImage = String(data?.qris_image ?? data?.qrisImage ?? data?.qr_image ?? "") || null;
    const paymentUrl = String(data?.payment_url ?? data?.paymentUrl ?? data?.pay_url ?? "") || null;
    const amount = Number(data?.amount ?? input.amount);
    const totalAmount = data?.total_amount != null ? Number(data.total_amount) : null;
    const status = data?.status ? String(data.status) : null;

    if (!transactionId) {
      logger.error({ body, orderId: input.orderId }, "BuatQris: no transaction_id in response");
      throw gatewayError("BuatQris returned no transaction_id", "INVALID_RESPONSE");
    }

    return { transactionId, qrUrl, qrisImage, paymentUrl, amount, totalAmount, status, raw: body };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Check the status of a BuatQris transaction.
 *
 * POST https://api.buatqris.site
 * form-urlencoded body:
 *   action=api_check_status
 *   account_id=...
 *   secret_token=...
 *   transaction_id=...
 *
 * Returns the provider status: "pending" | "success" | "expired" | "failed".
 */
export async function checkQrisStatus(transactionId: string): Promise<{
  status: "pending" | "success" | "expired" | "failed" | null;
  amount: number | null;
  transactionId: string | null;
  orderId: string | null;
  raw: unknown;
}> {
  if (!accountId() || !secretToken()) {
    throw gatewayError("BUATQRIS_ACCOUNT_ID / BUATQRIS_SECRET_TOKEN is not configured", "NOT_CONFIGURED");
  }

  const params = new URLSearchParams({
    action: "api_check_status",
    account_id: accountId()!,
    secret_token: secretToken()!,
    transaction_id: transactionId,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(BUATQRIS_BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: params.toString(),
      signal: controller.signal,
    });

    const text = await response.text();
    let body: any = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = { rawText: text };
    }

    if (!response.ok) {
      logger.error(
        { httpStatus: response.status, providerError: text.slice(0, 200), transactionId },
        "[BUATQRIS CHECK STATUS] HTTP error from provider",
      );
      throw gatewayError(`BuatQris status check failed (HTTP ${response.status})`, "GATEWAY_ERROR");
    }

    const data = body?.data ?? body?.result ?? body;
    const rawStatus = String(data?.status ?? body?.status ?? "").toLowerCase();

    // Map provider status to our canonical values.
    let status: "pending" | "success" | "expired" | "failed" | null = null;
    if (["success", "paid", "completed", "settled"].includes(rawStatus)) {
      status = "success";
    } else if (rawStatus === "pending") {
      status = "pending";
    } else if (rawStatus === "expired") {
      status = "expired";
    } else if (["failed", "error", "gagal"].includes(rawStatus)) {
      status = "failed";
    }

    const amount = data?.amount != null ? Number(data.amount) : null;
    const txId = String(data?.transaction_id ?? data?.transactionId ?? data?.trx_id ?? "") || null;
    const orderId = String(data?.order_id ?? data?.orderId ?? data?.description ?? "") || null;

    logger.info(
      { transactionId, providerStatus: rawStatus, mappedStatus: status },
      "[BUATQRIS CHECK STATUS] result",
    );

    return { status, amount, transactionId: txId, orderId, raw: body };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Verify the BuatQris webhook signature.
 *
 * Header: X-BuatQris-Signature
 * Format:  sha256=<HMAC_SHA256(rawBody, BUATQRIS_WEBHOOK_SECRET)>
 *
 * Uses the RAW request body — never re-stringifies JSON before hashing.
 * Constant-time comparison.
 */
export function verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
  const secret = webhookSecret();
  if (!secret || !signature) return false;

  const received = signature.trim().replace(/^sha256=/i, "");
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

  const expectedBuffer = Buffer.from(expected, "utf8");
  const receivedBuffer = Buffer.from(received, "utf8");

  if (expectedBuffer.length !== receivedBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

export function gatewayErrorCode(error: unknown): string {
  const code = (error as any)?.code;
  if (code) return String(code);
  logger.warn({ error: (error as any)?.message ?? String(error) }, "BuatQris request failed");
  return "GATEWAY_ERROR";
}
