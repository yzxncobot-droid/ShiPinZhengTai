/**
 * OwnerStorage — Unified Supabase project
 *
 * Used exclusively for Owner and Admin video uploads.
 *
 * Environment variables:
 *   SUPABASE_URL               (required)
 *   SUPABASE_SERVICE_ROLE_KEY  (required)
 *
 * Bucket: yzx
 * Folders:
 *   Videos:     yzx/owner/videos/
 *   Thumbnails: yzx/owner/thumbnails/
 */

import { logger } from "../logger";
import type { StorageService, UploadThumbnailResult, UploadVideoResult } from "./types";
import {
  generateStoragePath,
  makeSupabaseThumbnailResult,
  makeSupabaseVideoResult,
  supabaseDeleteFile,
  supabaseUploadWithRetry,
  unifiedSupabaseClient as client,
  UNIFIED_SUPABASE_URL as SUPABASE_URL,
  UNIFIED_BUCKET as BUCKET,
  isUnifiedSupabaseAvailable,
} from "./supabase-helpers";

const VIDEO_FOLDER = "owner/videos";
const THUMB_FOLDER = "owner/thumbnails";

export const isOwnerStorageAvailable = isUnifiedSupabaseAvailable;

/**
 * Kept for backward-compat imports in upload.ts debug endpoint.
 * Always false in current architecture (Bunny Stream no longer used).
 */
export const isBunnyStreamAvailable = false;

if (!isOwnerStorageAvailable) {
  logger.warn(
    "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — " +
    "Owner video uploads will fail. Set these secrets to enable Owner storage.",
  );
}

function checkAvailable() {
  if (!isOwnerStorageAvailable) {
    throw new Error(
      "Owner storage tidak dikonfigurasi " +
      "(SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum diset). " +
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
      client, SUPABASE_URL, BUCKET, storagePath, file.buffer, file.mimetype,
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
      client, SUPABASE_URL, BUCKET, storagePath, file.buffer, file.mimetype,
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
