import { logger } from "./logger";

const JAGOPAY_BASE_URL = "https://jagopay.my.id/api.php";

export type GatewayState = "CONNECTED" | "NOT_CONFIGURED" | "INVALID" | "AUTHENTICATION_REQUIRED";

export interface QrisCreation {
  qrisUrl: string | null;
  qrisString: string | null;
  gatewayReference: string | null;
  expiresAt: Date | null;
  raw: unknown;
}

export interface MutationRecord {
  amount: number | null;
  reference: string | null;
  description: string;
  occurredAt: Date | null;
  status: string | null;
  raw: unknown;
}

function apiKey(): string | null {
  const value = process.env.JAGOPAY_API_KEY?.trim();
  return value || null;
}

function endpoint(action: string, params: Record<string, string> = {}): string {
  const key = apiKey();
  const query = new URLSearchParams({ apikey: key ?? "", action, ...params });
  return `${JAGOPAY_BASE_URL}?${query.toString()}`;
}

async function request(action: string, params: Record<string, string> = {}): Promise<any> {
  if (!apiKey()) {
    const error = new Error("JAGOPAY_API_KEY is not configured");
    (error as any).code = "NOT_CONFIGURED";
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    // Do not log this URL: it contains the secret API key.
    const response = await fetch(endpoint(action, params), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    let body: any = null;
    try { body = await response.json(); } catch { body = null; }
    if (!response.ok) {
      const error = new Error(`JagoPay request failed (${response.status})`);
      (error as any).code = response.status === 401 || response.status === 403 ? "INVALID" : "GATEWAY_ERROR";
      throw error;
    }
    if (body?.status === false || body?.success === false) {
      const error = new Error(String(body?.message ?? "JagoPay rejected the request"));
      (error as any).code = /auth|session|login|otp/i.test(error.message)
        ? "AUTHENTICATION_REQUIRED"
        : "GATEWAY_ERROR";
      throw error;
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

function firstValue(source: any, keys: string[]): unknown {
  for (const key of keys) {
    if (source && source[key] != null) return source[key];
  }
  return undefined;
}

function asDate(value: unknown): Date | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
    if (match) {
      const [, day, month, year, hour = "00", minute = "00", second = "00"] = match;
      const date = new Date(
        Number(year), Number(month) - 1, Number(day),
        Number(hour), Number(minute), Number(second),
      );
      return Number.isNaN(date.getTime()) ? null : date;
    }
  }
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getGatewayState(): GatewayState {
  return apiKey() ? "CONNECTED" : "NOT_CONFIGURED";
}

export async function createDynamicQris(amount: number): Promise<QrisCreation> {
  const body = await request("qris_dinamis", { nominal: String(amount) });
  const data = body?.data ?? body?.result ?? body;
  const qrisUrl = String(firstValue(data, ["qris_url", "qr_url", "image_url", "url"]) ?? "") || null;
  const qrisString = String(firstValue(data, ["qris_string", "qr_string", "qr"]) ?? "") || null;
  const reference = String(firstValue(data, ["reference", "ref", "trx_id", "transaction_id", "id"]) ?? "") || null;
  const expiresRaw = firstValue(data, ["expired_at", "expires_at", "expiredAt"]);

  return {
    qrisUrl,
    qrisString,
    gatewayReference: reference,
    // JagoPay currently documents no expiry field. Keep a conservative
    // 15-minute transaction window until the gateway returns one.
    expiresAt: asDate(expiresRaw) ?? new Date(Date.now() + 15 * 60 * 1000),
    raw: body,
  };
}

function flattenRecords(value: any): any[] {
  if (Array.isArray(value)) return value.flatMap(flattenRecords);
  if (!value || typeof value !== "object") return [];
  // JagoPay returns qris_mutasi records under data.mutasi. Keep the
  // generic fallbacks for compatible gateway response wrappers.
  for (const key of ["mutasi", "mutations", "transactions", "results"]) {
    if (Array.isArray(value[key])) return value[key].flatMap(flattenRecords);
  }
  if (value.data && typeof value.data === "object") {
    return flattenRecords(value.data);
  }
  return [value];
}

export async function fetchQrisMutations(): Promise<MutationRecord[]> {
  const body = await request("qris_mutasi", { page: "1" });
  return flattenRecords(body).map((item: any) => {
    const amountRaw = firstValue(item, ["amount", "nominal", "jumlah", "total", "kredit"]);
    const parsedAmount = Number(String(amountRaw ?? "").replace(/[^\d.-]/g, ""));
    return {
      amount: Number.isFinite(parsedAmount) ? parsedAmount : null,
      reference: String(firstValue(item, [
        "reference", "ref", "trx_id", "transaction_id", "id", "kode",
      ]) ?? "") || null,
      description: String(firstValue(item, ["description", "keterangan", "note", "remark"]) ?? ""),
      occurredAt: asDate(firstValue(item, [
        "created_at", "createdAt", "date", "tanggal", "time", "waktu",
      ])),
      status: String(firstValue(item, ["status", "state"]) ?? "") || null,
      raw: item,
    };
  });
}

export function gatewayErrorCode(error: unknown): string {
  const code = (error as any)?.code;
  if (code === "NOT_CONFIGURED" || code === "INVALID" || code === "AUTHENTICATION_REQUIRED") {
    return code;
  }
  logger.warn({ error: (error as any)?.message ?? String(error) }, "JagoPay request failed");
  return "GATEWAY_ERROR";
}