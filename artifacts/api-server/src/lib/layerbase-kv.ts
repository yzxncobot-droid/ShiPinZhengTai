import { Redis } from "@upstash/redis";
import { logger } from "./logger";

const KV_URL = process.env.KV_REST_API_URL?.trim() ?? "";
const KV_TOKEN = process.env.KV_REST_API_TOKEN?.trim() ?? "";

/** True when Layerbase Valkey credentials are present. */
export const isLayerbaseKVAvailable = Boolean(KV_URL && KV_TOKEN);

/**
 * Layerbase Valkey client (Redis-compatible REST API).
 *
 * Single shared instance — all KV access goes through `redis.ts`, never
 * directly.  The token is read from the environment and never logged,
 * returned in API responses, or sent to the frontend.
 */
export const layerbaseKV = isLayerbaseKVAvailable
  ? new Redis({ url: KV_URL, token: KV_TOKEN })
  : null;

if (isLayerbaseKVAvailable) {
  logger.info("Layerbase Valkey configured for cache/session storage");
}
