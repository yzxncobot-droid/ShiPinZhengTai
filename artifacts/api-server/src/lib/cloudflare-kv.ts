import { logger } from "./logger";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? "";
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN?.trim() ?? "";
const NAMESPACE_ID = process.env.CLOUDFLARE_KV_NAMESPACE_ID?.trim() ?? "";
const BASE_URL = ACCOUNT_ID && NAMESPACE_ID
  ? `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(ACCOUNT_ID)}/storage/kv/namespaces/${encodeURIComponent(NAMESPACE_ID)}/values`
  : "";

export const isCloudflareKVAvailable = Boolean(ACCOUNT_ID && API_TOKEN && NAMESPACE_ID);

function keyUrl(key: string, ttlSeconds?: number): string {
  if (!BASE_URL) throw new Error("Cloudflare KV is not configured");
  const url = `${BASE_URL}/${encodeURIComponent(key)}`;
  return ttlSeconds ? `${url}?expiration_ttl=${Math.max(60, Math.floor(ttlSeconds))}` : url;
}

async function request(url: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok && response.status !== 404) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Cloudflare KV request failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  return response;
}

function decodeValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Cloudflare KV is eventually consistent and has no atomic increment.
 * It is therefore used only for sessions and cache values, never rate limits
 * or view counters that require atomic updates.
 */
export const cloudflareKV = {
  async get<T = string>(key: string): Promise<T | null> {
    const response = await request(keyUrl(key));
    if (response.status === 404) return null;
    return decodeValue(await response.text()) as T;
  },

  async setex(key: string, ttlSeconds: number, value: string): Promise<"OK"> {
    await request(keyUrl(key, ttlSeconds), {
      method: "PUT",
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: value,
    });
    return "OK";
  },

  async del(...keys: string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) {
      const response = await request(keyUrl(key), { method: "DELETE" });
      if (response.ok) deleted += 1;
    }
    return deleted;
  },

  async ping(): Promise<"PONG"> {
    if (!isCloudflareKVAvailable) throw new Error("Cloudflare KV is not configured");
    await request(`${BASE_URL}?limit=1`);
    return "PONG";
  },
};

if (isCloudflareKVAvailable) {
  logger.info("Cloudflare KV configured for cache/session storage");
}