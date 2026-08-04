/**
 * PublicStorage — Supabase PUBLIC project
 *
 * Used for ALL Creator and Verified Creator uploads.
 *
 * Environment variables:
 *   PUBLIC_SUPABASE_URL          (required)
 *   PUBLIC_SUPABASE_SERVICE_KEY  (required)
 *
 * Bucket: public
 * Folders:
 *   Creator videos:    public/videos/{userId}/
 *   Creator thumbs:    public/thumbnails/{userId}/
 *   VC payments:       public/verified-creator/payments/{userId}/
 */

import { logger } from "../logger";
import type {
  StorageService,
  UploadThumbnailResult,
  UploadVideoResult,
  UploadProofResult,
} from "./types";
import {
  buildSupabaseClient,
  generateStoragePath,
  generateStoragePathForUser,
  makeSupabaseThumbnailResult,
  makeSupabaseVideoResult,
  supabaseDeleteFile,
  supabaseUploadWithRetry,
} from "./supabase-helpers";

const PUBLIC_SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL ?? "";
const PUBLIC_SUPABASE_KEY = process.env.PUBLIC_SUPABASE_SERVICE_KEY ?? "";
const BUCKET = "public";

export const isPublicStorageAvailable =
  !!PUBLIC_SUPABASE_URL && !!PUBLIC_SUPABASE_KEY;

if (!isPublicStorageAvailable) {
  logger.warn(
    "PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_SERVICE_KEY not set — " +
    "Creator and Verified Creator uploads will fail.",
  );
}

const client = buildSupabaseClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_KEY);

function checkAvailable() {
  if (!isPublicStorageAvailable) {
    throw new Error(
      "Public storage tidak dikonfigurasi " +
      "(PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_SERVICE_KEY belum diset). " +
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
      client, PUBLIC_SUPABASE_URL, BUCKET, storagePath, file.buffer, file.mimetype,
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
      client, PUBLIC_SUPABASE_URL, BUCKET, storagePath, file.buffer, file.mimetype,
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
      client, PUBLIC_SUPABASE_URL, BUCKET, storagePath, file.buffer, file.mimetype,
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
      client, PUBLIC_SUPABASE_URL, BUCKET, storagePath, file.buffer, file.mimetype,
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
 * Upload any generic file (image, bundle video, bundle thumbnail) to the PUBLIC
 * Supabase project under the given folder.
 *
 * Drop-in replacement for the legacy uploadToLegacyBucket() that required the
 * now-unused SUPABASE_URL env var.
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
    client, PUBLIC_SUPABASE_URL, BUCKET, storagePath, file.buffer, file.mimetype,
  );
  return { path: savedPath, url };
}

/**
 * Upload a payment proof — always goes to public/verified-creator/payments/{userId}/
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
    client, PUBLIC_SUPABASE_URL, BUCKET, storagePath, file.buffer, file.mimetype,
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
