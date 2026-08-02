/**
 * OwnerStorage — Supabase OWNER project
 *
 * Used exclusively for Owner and Admin video uploads.
 *
 * Environment variables:
 *   OWNER_SUPABASE_URL         (required)
 *   OWNER_SUPABASE_SERVICE_KEY (required)
 *
 * Bucket: yzx
 * Folders:
 *   Videos:     yzx/owner/videos/
 *   Thumbnails: yzx/owner/thumbnails/
 *
 * ── Legacy Bunny Stream ────────────────────────────────────────────────────────
 * The old implementation used Bunny Stream for Owner video uploads.
 * Bunny Stream support has been removed from new uploads. Existing DB rows
 * with videoStorageProvider = "bunny_stream" continue to work because
 * the video_url stored in Neon is a direct CDN/embed URL that needs no
 * server-side routing — only the upload path has changed.
 */

import { logger } from "../logger";
import type { StorageService, UploadThumbnailResult, UploadVideoResult } from "./types";
import {
  buildSupabaseClient,
  generateStoragePath,
  makeSupabaseThumbnailResult,
  makeSupabaseVideoResult,
  supabaseDeleteFile,
  supabaseUploadWithRetry,
} from "./supabase-helpers";

const OWNER_SUPABASE_URL = process.env.OWNER_SUPABASE_URL ?? "";
const OWNER_SUPABASE_KEY = process.env.OWNER_SUPABASE_SERVICE_KEY ?? "";
const BUCKET = "yzx";
const VIDEO_FOLDER = "owner/videos";
const THUMB_FOLDER = "owner/thumbnails";

export const isOwnerStorageAvailable =
  !!OWNER_SUPABASE_URL && !!OWNER_SUPABASE_KEY;

/**
 * Kept for backward-compat imports in upload.ts debug endpoint.
 * Always false in new architecture (Bunny Stream no longer used).
 */
export const isBunnyStreamAvailable = false;

if (!isOwnerStorageAvailable) {
  logger.warn(
    "OWNER_SUPABASE_URL / OWNER_SUPABASE_SERVICE_KEY not set — " +
    "Owner video uploads will fail. Set these secrets to enable Owner storage.",
  );
}

const client = buildSupabaseClient(OWNER_SUPABASE_URL, OWNER_SUPABASE_KEY);

function checkAvailable() {
  if (!isOwnerStorageAvailable) {
    throw new Error(
      "Owner storage tidak dikonfigurasi " +
      "(OWNER_SUPABASE_URL / OWNER_SUPABASE_SERVICE_KEY belum diset). " +
      "Hubungi admin untuk mengaktifkan Owner upload.",
    );
  }
}

export const ownerStorage: StorageService = {
  async uploadVideo(file, _opts): Promise<UploadVideoResult> {
    checkAvailable();
    const storagePath = generateStoragePath(VIDEO_FOLDER, file.originalname);
    logger.info({ bucket: BUCKET, path: storagePath, size: file.size }, "OwnerStorage: upload video START");
    const { path: savedPath, url } = await supabaseUploadWithRetry(
      client, OWNER_SUPABASE_URL, BUCKET, storagePath, file.buffer, file.mimetype,
    );
    logger.info({ path: savedPath }, "OwnerStorage: upload video SUCCESS");
    return makeSupabaseVideoResult({
      path: savedPath, url,
      storageProvider: "supabase_owner",
      storageType: "OWNER",
      bucketName: BUCKET,
      storageFolder: VIDEO_FOLDER,
    });
  },

  async uploadThumbnail(file): Promise<UploadThumbnailResult> {
    checkAvailable();
    const storagePath = generateStoragePath(THUMB_FOLDER, file.originalname);
    logger.info({ bucket: BUCKET, path: storagePath, size: file.size }, "OwnerStorage: upload thumbnail START");
    const { path: savedPath, url } = await supabaseUploadWithRetry(
      client, OWNER_SUPABASE_URL, BUCKET, storagePath, file.buffer, file.mimetype,
    );
    logger.info({ path: savedPath }, "OwnerStorage: upload thumbnail SUCCESS");
    return makeSupabaseThumbnailResult({
      path: savedPath, url,
      storageProvider: "supabase_owner",
      storageType: "OWNER",
      bucketName: BUCKET,
      storageFolder: THUMB_FOLDER,
    });
  },

  async deleteVideo(storagePath) {
    await supabaseDeleteFile(client, BUCKET, storagePath);
  },

  async deleteThumbnail(storagePath) {
    await supabaseDeleteFile(client, BUCKET, storagePath);
  },
};
