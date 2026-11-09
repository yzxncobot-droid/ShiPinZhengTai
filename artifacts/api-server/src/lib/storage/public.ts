/**
 * PublicStorage — Unified Supabase project
 *
 * Used for ALL Creator and Verified Creator uploads.
 *
 * Environment variables:
 *   SUPABASE_URL               (required)
 *   SUPABASE_SERVICE_ROLE_KEY  (required)
 *
 * Bucket: yzx
 * Folders:
 *   Creator videos:    yzx/videos/{userId}/
 *   Creator thumbs:    yzx/thumbnails/{userId}/
 *   VC payments:       yzx/verified-creator/payments/{userId}/
 */

import { logger } from "../logger";
import type {
  StorageService,
  UploadThumbnailResult,
  UploadVideoResult,
  UploadProofResult,
} from "./types";
import {
  generateStoragePathForUser,
  makeSupabaseThumbnailResult,
  makeSupabaseVideoResult,
  supabaseDeleteFile,
  supabaseUploadWithRetry,
  unifiedSupabaseClient as client,
  UNIFIED_SUPABASE_URL as SUPABASE_URL,
  UNIFIED_BUCKET as BUCKET,
  isUnifiedSupabaseAvailable,
} from "./supabase-helpers";

export const isPublicStorageAvailable = isUnifiedSupabaseAvailable;

if (!isPublicStorageAvailable) {
  logger.warn(
    "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — " +
    "Creator and Verified Creator uploads will fail.",
  );
}

function checkAvailable() {
  if (!isPublicStorageAvailable) {
    throw new Error(
      "Storage tidak dikonfigurasi " +
      "(SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum diset). " +
      "Hubungi admin untuk mengaktifkan upload.",
    );
  }
}

// ── Creator ───────────────────────────────────────────────────────────────────
// All custom-role creators share the same top-level folders, organised by
// their user ID so files never collide across accounts.
//
//   videos/{userId}/{timestamp}-{random}.ext
//   thumbnails/{userId}/{timestamp}-{random}.ext

const VIDEO_FOLDER = "videos";
const THUMB_FOLDER = "thumbnails";

export const creatorPublicStorage: StorageService = {
  async uploadVideo(file, opts): Promise<UploadVideoResult> {
    checkAvailable();
    const userId = opts?.userId ?? "unknown";
    const storagePath = generateStoragePathForUser(VIDEO_FOLDER, userId, file.originalname);
    logger.info({ bucket: BUCKET, path: storagePath, size: file.size, userId }, "PublicStorage[Creator]: upload video START");
    const { path: savedPath, url } = await supabaseUploadWithRetry(
      client, SUPABASE_URL, BUCKET, storagePath, file.buffer, file.mimetype,
    );
    logger.info({ path: savedPath }, "PublicStorage[Creator]: upload video SUCCESS");
    return makeSupabaseVideoResult({
      path: savedPath, url,
      storageProvider: "supabase_public",
      storageType: "PUBLIC",
      bucketName: BUCKET,
      storageFolder: `${VIDEO_FOLDER}/${userId}`,
    });
  },

  async uploadThumbnail(file, opts): Promise<UploadThumbnailResult> {
    checkAvailable();
    const userId = opts?.userId ?? "unknown";
    const storagePath = generateStoragePathForUser(THUMB_FOLDER, userId, file.originalname);
    logger.info({ bucket: BUCKET, path: storagePath, size: file.size, userId }, "PublicStorage[Creator]: upload thumbnail START");
    const { path: savedPath, url } = await supabaseUploadWithRetry(
      client, SUPABASE_URL, BUCKET, storagePath, file.buffer, file.mimetype,
    );
    logger.info({ path: savedPath }, "PublicStorage[Creator]: upload thumbnail SUCCESS");
    return makeSupabaseThumbnailResult({
      path: savedPath, url,
      storageProvider: "supabase_public",
      storageType: "PUBLIC",
      bucketName: BUCKET,
      storageFolder: `${THUMB_FOLDER}/${userId}`,
    });
  },

  async deleteVideo(storagePath) { await supabaseDeleteFile(client, BUCKET, storagePath); },
  async deleteThumbnail(storagePath) { await supabaseDeleteFile(client, BUCKET, storagePath); },
};

// ── Verified Creator — same bucket/folder layout as Creator ──────────────────

const VC_PAYMENTS_FOLDER = "verified-creator/payments";

export const verifiedCreatorPublicStorage: StorageService = {
  async uploadVideo(file, opts): Promise<UploadVideoResult> {
    checkAvailable();
    const userId = opts?.userId ?? "unknown";
    const storagePath = generateStoragePathForUser(VIDEO_FOLDER, userId, file.originalname);
    logger.info({ bucket: BUCKET, path: storagePath, size: file.size, userId }, "PublicStorage[VerifiedCreator]: upload video START");
    const { path: savedPath, url } = await supabaseUploadWithRetry(
      client, SUPABASE_URL, BUCKET, storagePath, file.buffer, file.mimetype,
    );
    logger.info({ path: savedPath }, "PublicStorage[VerifiedCreator]: upload video SUCCESS");
    return makeSupabaseVideoResult({
      path: savedPath, url,
      storageProvider: "supabase_public",
      storageType: "PUBLIC",
      bucketName: BUCKET,
      storageFolder: `${VIDEO_FOLDER}/${userId}`,
    });
  },

  async uploadThumbnail(file, opts): Promise<UploadThumbnailResult> {
    checkAvailable();
    const userId = opts?.userId ?? "unknown";
    const storagePath = generateStoragePathForUser(THUMB_FOLDER, userId, file.originalname);
    logger.info({ bucket: BUCKET, path: storagePath, size: file.size, userId }, "PublicStorage[VerifiedCreator]: upload thumbnail START");
    const { path: savedPath, url } = await supabaseUploadWithRetry(
      client, SUPABASE_URL, BUCKET, storagePath, file.buffer, file.mimetype,
    );
    logger.info({ path: savedPath }, "PublicStorage[VerifiedCreator]: upload thumbnail SUCCESS");
    return makeSupabaseThumbnailResult({
      path: savedPath, url,
      storageProvider: "supabase_public",
      storageType: "PUBLIC",
      bucketName: BUCKET,
      storageFolder: `${THUMB_FOLDER}/${userId}`,
    });
  },

  async deleteVideo(storagePath) { await supabaseDeleteFile(client, BUCKET, storagePath); },
  async deleteThumbnail(storagePath) { await supabaseDeleteFile(client, BUCKET, storagePath); },
};

/**
 * Upload any generic file (image, bundle video, bundle thumbnail) to the
 * unified Supabase project under the given folder.
 */
export async function uploadToPublicBucket(
  folder: string,
  file: Express.Multer.File,
): Promise<{ path: string; url: string }> {
  checkAvailable();
  const path = require("path");
  const ext = path.extname(file.originalname).toLowerCase();
  const storagePath = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
  const { path: savedPath, url } = await supabaseUploadWithRetry(
    client, SUPABASE_URL, BUCKET, storagePath, file.buffer, file.mimetype,
  );
  return { path: savedPath, url };
}

/**
 * Upload a payment proof — goes to verified-creator/payments/{userId}/
 */
export async function uploadPublicPaymentProof(
  file: Express.Multer.File,
  userId: string,
): Promise<UploadProofResult> {
  checkAvailable();
  const path = require("path");
  const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
  const storagePath = `${VC_PAYMENTS_FOLDER}/${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
  logger.info({ bucket: BUCKET, path: storagePath, size: file.size, userId }, "PublicStorage: upload payment-proof START");
  const { path: savedPath, url } = await supabaseUploadWithRetry(
    client, SUPABASE_URL, BUCKET, storagePath, file.buffer, file.mimetype,
  );
  logger.info({ path: savedPath }, "PublicStorage: upload payment-proof SUCCESS");
  return {
    url,
    path: savedPath,
    storageProvider: "supabase_public",
    storageType: "PUBLIC",
    bucketName: BUCKET,
    storageFolder: VC_PAYMENTS_FOLDER,
  };
}
