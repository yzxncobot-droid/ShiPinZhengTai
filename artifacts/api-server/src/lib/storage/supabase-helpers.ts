/**
 * Shared Supabase storage helpers used by all storage services.
 * Each storage service gets its own Supabase client instance (different project credentials).
 */

// Node 20 lacks native WebSocket; supabase-js v2 requires it for realtime init.
// We only use the Storage API, but the realtime client is always constructed.
// Polyfill with the `ws` package that ships as a direct dependency.
if (typeof globalThis.WebSocket === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { WebSocket: WS } = require("ws");
  (globalThis as any).WebSocket = WS;
}

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import path from "path";
import { logger } from "../logger";
import type { StorageProvider, StorageType, UploadThumbnailResult, UploadVideoResult } from "./types";

/**
 * Extract the project ref from a Supabase URL.
 * e.g. "https://dwamzsczuuhppiixtbaz.supabase.co" → "dwamzsczuuhppiixtbaz"
 */
function extractRefFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const match = u.hostname.match(/^([a-z0-9]+)\.supabase\.co$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Extract the project ref from a Supabase service key JWT payload.
 * The payload contains a "ref" field with the project reference.
 */
function extractRefFromKey(key: string): string | null {
  try {
    const payload = key.split(".")[1];
    if (!payload) return null;
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return decoded?.ref ?? null;
  } catch {
    return null;
  }
}

/**
 * Normalize a Supabase URL to match the project ref embedded in the service key.
 *
 * If the URL's project ref doesn't match the key's ref, the URL is
 * auto-corrected to `https://<key-ref>.supabase.co`. This prevents
 * "signature verification failed" errors when the configured URL and
 * service key belong to different Supabase projects.
 *
 * Returns the original URL when:
 *   - either argument is empty
 *   - the URL or key cannot be parsed for a ref
 *   - both refs already match
 */
export function normalizeSupabaseUrl(url: string, serviceKey: string): string {
  if (!url || !serviceKey) return url;
  const urlRef = extractRefFromUrl(url);
  const keyRef = extractRefFromKey(serviceKey);
  if (!urlRef || !keyRef) return url;
  if (urlRef === keyRef) return url;
  const corrected = `https://${keyRef}.supabase.co`;
  logger.warn(
    { configuredUrl: url, correctedUrl: corrected, keyRef },
    "Supabase URL mismatch: URL project ref does not match service key ref. Auto-correcting URL to match the key.",
  );
  return corrected;
}

export function buildSupabaseClient(url: string, serviceKey: string): SupabaseClient {
  const normalizedUrl = normalizeSupabaseUrl(url, serviceKey);
  return createClient(
    normalizedUrl || "https://placeholder.supabase.co",
    serviceKey || "placeholder",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

function extOf(filename: string): string {
  return path.extname(filename).toLowerCase();
}

export function generateStoragePath(folder: string, originalName: string): string {
  const ext = extOf(originalName);
  return `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
}

/**
 * Generate a storage path scoped to a specific user ID.
 * e.g. generateStoragePathForUser("videos", "user-123", "clip.mp4")
 *   → "videos/user-123/1720000000000-abc123.mp4"
 */
export function generateStoragePathForUser(
  folder: string,
  userId: string,
  originalName: string,
): string {
  const ext = extOf(originalName);
  return `${folder}/${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
}

export async function supabaseUploadWithRetry(
  client: SupabaseClient,
  supabaseUrl: string,
  bucket: string,
  storagePath: string,
  buffer: Buffer,
  contentType: string,
  maxRetries = 3,
): Promise<{ path: string; url: string }> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const { data, error } = await client.storage
      .from(bucket)
      .upload(storagePath, buffer, { contentType, upsert: false });

    if (!error) {
      const url = `${supabaseUrl}/storage/v1/object/public/${bucket}/${data.path}`;
      return { path: data.path, url };
    }

    lastError = new Error(error.message);

    const status = (error as any).statusCode ?? (error as any).status ?? 500;
    if (status >= 400 && status < 500) break; // don't retry client errors

    if (attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
    }
  }

  throw lastError ?? new Error("Supabase upload failed after retries");
}

/**
 * Decode a Supabase JWT (without verifying the signature) and return the `role`
 * claim.  Returns "unknown" if the token cannot be parsed.
 *
 * Supabase service_role JWTs carry `{ "role": "service_role" }`.
 * Anon JWTs carry `{ "role": "anon" }`.
 * Using an anon key for server-side uploads will be blocked by RLS.
 */
export function getJwtRole(jwt: string): string {
  try {
    const payload = jwt.split(".")[1];
    if (!payload) return "unknown";
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return decoded?.role ?? "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Ensure the given bucket exists in the Supabase project.
 * Creates it (public=true, fileSizeLimit=524288000 i.e. 500 MB) if absent.
 * Silently ignores "already exists" errors.
 * Logs a warning (non-fatal) for any other error.
 *
 * Call this during server startup as a best-effort step — never let it block
 * the server from starting.
 */
export async function ensureBucket(
  client: SupabaseClient,
  bucket: string,
  label: string,
): Promise<void> {
  // Step 1 — try to fetch the bucket; if it exists, ensure it's public.
  const { data: existing, error: getErr } = await client.storage.getBucket(bucket);
  if (existing) {
    // Ensure the bucket is public — update if needed.
    if (!(existing as any).public) {
      const { error: updateErr } = await client.storage.updateBucket(bucket, { public: true });
      if (!updateErr) {
        logger.info({ bucket, label }, "Storage: bucket updated to public");
      } else {
        logger.warn({ bucket, label, error: updateErr.message }, "Storage: could not update bucket to public (non-fatal)");
      }
    } else {
      logger.info({ bucket, label }, "Storage: bucket exists (public) — OK");
    }
    return;
  }

  // getBucket can return a 400/404 when the bucket doesn't exist (varies by
  // Supabase version); ignore that and try to create it.

  // Step 2 — create the bucket (public so uploaded files are readable by URL).
  const { error: createErr } = await client.storage.createBucket(bucket, {
    public: true,
  });
  if (!createErr) {
    logger.info({ bucket, label }, "Storage: bucket created (public)");
    return;
  }

  // Treat "already exists" / "duplicate" / plan-limit errors as success —
  // the bucket is present (or was just created by a concurrent request).
  const msg = createErr.message.toLowerCase();
  if (
    msg.includes("already exists") ||
    msg.includes("duplicate") ||
    msg.includes("exceeded") ||  // free-tier plan limit — bucket may still exist
    msg.includes("maximum allowed")
  ) {
    logger.info({ bucket, label, hint: createErr.message }, "Storage: bucket already exists or plan limit — OK");
    return;
  }

  // Anything else is unexpected — warn but don't crash the server.
  logger.warn({ bucket, label, error: createErr.message }, "Storage: ensureBucket warning (non-fatal)");
}

/**
 * Ensure the expected folder structure exists inside the bucket by uploading
 * zero-byte placeholder files (.keep) at each folder path. Supabase Storage
 * has no explicit "create folder" API — folders are implicit path prefixes
 * that appear when objects are uploaded. The placeholders make the structure
 * visible and ready before the first real upload.
 *
 * All folders use the consolidated bucket "yzx" with these prefixes:
 *   owner/videos/            ← owner/admin video uploads
 *   owner/thumbnails/        ← owner/admin thumbnail uploads
 *   videos/{userId}/         ← creator video uploads (per-user)
 *   thumbnails/{userId}/     ← creator thumbnail uploads (per-user)
 *   verified-creator/payments/{userId}/  ← VC payment proofs
 *   media/autoup-thumbnails/ ← AutoUP generated thumbnails
 *   media/avatars/           ← profile photos
 *   media/banners/           ← site/user/category banners
 *   media/bundle-thumbnails/ ← bundle cover images
 *   media/bundle-banners/    ← bundle banner images
 *   media/qris/              ← QRIS payment images
 *   media/home-feed/         ← home feed videos & thumbnails
 *   media/chat/              ← chat images, videos, voice, files
 *
 * Access model:
 *   - Bucket is public=true → all objects are readable via public URLs.
 *   - service_role key bypasses RLS → all writes succeed.
 *   - No additional RLS policies needed for the current architecture.
 */
export async function ensureFolderStructure(
  client: SupabaseClient,
  bucket: string,
  label: string,
): Promise<void> {
  const folders = [
    "owner/videos",
    "owner/thumbnails",
    "videos",
    "thumbnails",
    "verified-creator/payments",
    "media/autoup-thumbnails",
    "media/avatars",
    "media/banners",
    "media/bundle-thumbnails",
    "media/bundle-banners",
    "media/qris",
    "media/home-feed/videos",
    "media/home-feed/thumbnails",
    "media/chat/images",
    "media/chat/videos",
    "media/chat/voice",
    "media/chat/files",
  ];

  let created = 0;
  for (const folder of folders) {
    const placeholderPath = `${folder}/.keep`;
    // Upload a 0-byte placeholder — upsert so it's idempotent.
    const { error } = await client.storage
      .from(bucket)
      .upload(placeholderPath, Buffer.alloc(0), {
        contentType: "application/octet-stream",
        upsert: true,
      });
    if (!error) {
      created++;
    } else if (!error.message.toLowerCase().includes("already exists")) {
      logger.warn({ bucket, folder, error: error.message }, "Storage: folder placeholder upload failed (non-fatal)");
    }
  }
  logger.info({ bucket, label, folders: created }, "Storage: folder structure ensured");
}

export async function supabaseDeleteFile(
  client: SupabaseClient,
  bucket: string,
  storagePath: string,
): Promise<void> {
  const { error } = await client.storage.from(bucket).remove([storagePath]);
  if (error) {
    logger.warn({ bucket, storagePath, error: error.message }, "Supabase delete failed (non-fatal)");
  }
}

/** Build a UploadVideoResult for a Supabase-backed upload */
export function makeSupabaseVideoResult(opts: {
  path: string;
  url: string;
  storageProvider: StorageProvider;
  storageType: StorageType;
  bucketName: string;
  storageFolder: string;
}): UploadVideoResult {
  return {
    url: opts.url,
    path: opts.path,
    storageProvider: opts.storageProvider,
    storageType: opts.storageType,
    bunnyVideoId: null,
    bunnyPlaybackUrl: null,
    bunnyLibraryId: null,
    bucketName: opts.bucketName,
    storageFolder: opts.storageFolder,
  };
}

/** Build a UploadThumbnailResult for a Supabase-backed upload */
export function makeSupabaseThumbnailResult(opts: {
  path: string;
  url: string;
  storageProvider: StorageProvider;
  storageType: StorageType;
  bucketName: string;
  storageFolder: string;
}): UploadThumbnailResult {
  return {
    url: opts.url,
    path: opts.path,
    storageProvider: opts.storageProvider,
    storageType: opts.storageType,
    bucketName: opts.bucketName,
    storageFolder: opts.storageFolder,
  };
}
