import { createClient } from "@supabase/supabase-js";
import { logger } from "./logger";
import WebSocket from "ws";

// Node.js 20 lacks a native WebSocket — polyfill for Supabase realtime
if (!globalThis.WebSocket) {
  (globalThis as any).WebSocket = WebSocket;
}

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/**
 * True when Supabase credentials are present.
 * File upload routes check this and return 503 when it is false so the server
 * still starts and all non-upload endpoints work normally.
 */
export const isSupabaseAvailable = !!supabaseUrl && !!supabaseKey;

if (!isSupabaseAvailable) {
  logger.warn(
    "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — " +
    "file uploads (video, thumbnail, payment proof) are disabled. " +
    "All other features work normally.",
  );
}

/**
 * Supabase client. Safe to import even when credentials are absent —
 * createClient() with empty strings does not throw. Any actual API call
 * (storage.upload, storage.listBuckets, etc.) will return an error response
 * which the route handlers convert to a user-friendly 503.
 */
export const supabase = createClient(
  supabaseUrl || "https://placeholder.supabase.co",
  supabaseKey || "placeholder",
  { auth: { persistSession: false, autoRefreshToken: false } },
);

/**
 * All media lives in the single "Yzu" bucket (default) unless overridden via
 * the SUPABASE_VIDEOS_BUCKET env var.  Sub-folders within the bucket:
 *   videos/      → uploaded video files
 *   thumbnails/  → video thumbnails
 *   images/      → avatars, logos, banners, QRIS
 *   payments/    → payment proof screenshots
 *
 * Set SUPABASE_VIDEOS_BUCKET to use a different bucket name.
 */
export const MEDIA_BUCKET         = process.env.SUPABASE_VIDEOS_BUCKET    ?? "Yzu";
export const THUMBNAILS_BUCKET    = process.env.SUPABASE_THUMBNAILS_BUCKET ?? MEDIA_BUCKET;
export const PAYMENTS_BUCKET_NAME = process.env.SUPABASE_PAYMENTS_BUCKET   ?? MEDIA_BUCKET;

/** @deprecated alias kept for call-sites still referencing PAYMENT_BUCKET */
export const PAYMENT_BUCKET = MEDIA_BUCKET;

/** Sub-folder within MEDIA_BUCKET where payment proofs are stored. */
export const PAYMENTS_FOLDER = "payments";

/** Build a public URL for a Supabase Storage object */
export function getPublicUrl(bucket: string, path: string): string {
  if (!supabaseUrl) return "";
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${path}`;
}

/**
 * Upload a buffer to a Supabase Storage bucket with automatic retry.
 * Retries up to `maxRetries` times with exponential back-off.
 * Throws a clear user-facing error when Supabase is not configured.
 */
export async function uploadWithRetry(
  bucket: string,
  path: string,
  buffer: Buffer,
  contentType: string,
  opts: { upsert?: boolean; maxRetries?: number } = {},
): Promise<{ path: string; url: string }> {
  if (!isSupabaseAvailable) {
    throw new Error(
      "Storage tidak dikonfigurasi (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum diset). " +
      "Hubungi admin untuk mengaktifkan fitur upload.",
    );
  }

  const { upsert = false, maxRetries = 3 } = opts;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(path, buffer, { contentType, upsert });

    if (!error) {
      return { path: data.path, url: getPublicUrl(bucket, data.path) };
    }

    lastError = new Error(error.message);

    // Don't retry on client-side errors (4xx)
    const status = (error as any).statusCode ?? (error as any).status ?? 500;
    if (status >= 400 && status < 500) break;

    if (attempt < maxRetries) {
      // Exponential back-off: 500 ms, 1 s, 2 s …
      await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
    }
  }

  throw lastError ?? new Error("Upload failed after retries");
}

/**
 * Feature flags — read from env, default to enabled.
 * Use these at runtime to guard feature-specific routes.
 */
export const features = {
  wallet:        process.env.ENABLE_WALLET        !== "false",
  subscriptions: process.env.ENABLE_SUBSCRIPTIONS !== "false",
  bundles:       process.env.ENABLE_BUNDLES        !== "false",
  referrals:     process.env.ENABLE_REFERRALS      !== "false",
  manualQris:    process.env.ENABLE_MANUAL_QRIS    !== "false",
} as const;
