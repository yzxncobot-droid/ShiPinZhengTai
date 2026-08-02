/**
 * Shared Supabase storage helpers used by all storage services.
 * Each storage service gets its own Supabase client instance (different project credentials).
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import path from "path";
import { logger } from "../logger";
import type { StorageProvider, StorageType, UploadThumbnailResult, UploadVideoResult } from "./types";

export function buildSupabaseClient(url: string, serviceKey: string): SupabaseClient {
  return createClient(
    url || "https://placeholder.supabase.co",
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
