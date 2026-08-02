/**
 * PublicStorage — Supabase PUBLIC project
 *
 * Used for ALL Creator and Verified Creator uploads.
 *
 * Environment variables:
 *   PUBLIC_SUPABASE_URL          (required)
 *   PUBLIC_SUPABASE_SERVICE_KEY  (required)
 *
 * Bucket: yzx
 * Folders:
 *   Creator videos:               yzx/public/creator/videos/
 *   Creator thumbnails:           yzx/public/creator/thumbnails/
 *   Verified Creator videos:      yzx/public/verified-creator/videos/
 *   Verified Creator thumbnails:  yzx/public/verified-creator/thumbnails/
 *   Verified Creator payments:    yzx/public/verified-creator/payments/
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
  makeSupabaseThumbnailResult,
  makeSupabaseVideoResult,
  supabaseDeleteFile,
  supabaseUploadWithRetry,
} from "./supabase-helpers";

const PUBLIC_SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL ?? "";
const PUBLIC_SUPABASE_KEY = process.env.PUBLIC_SUPABASE_SERVICE_KEY ?? "";
const BUCKET = "yzx";

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

const CREATOR_VIDEO_FOLDER = "public/creator/videos";
const CREATOR_THUMB_FOLDER = "public/creator/thumbnails";

export const creatorPublicStorage: StorageService = {
  async uploadVideo(file, _opts): Promise<UploadVideoResult> {
    checkAvailable();
    const storagePath = generateStoragePath(CREATOR_VIDEO_FOLDER, file.originalname);
    logger.info({ bucket: BUCKET, path: storagePath, size: file.size }, "PublicStorage[Creator]: upload video START");
    const { path: savedPath, url } = await supabaseUploadWithRetry(
      client, PUBLIC_SUPABASE_URL, BUCKET, storagePath, file.buffer, file.mimetype,
    );
    logger.info({ path: savedPath }, "PublicStorage[Creator]: upload video SUCCESS");
    return makeSupabaseVideoResult({
      path: savedPath, url,
      storageProvider: "supabase_public",
      storageType: "PUBLIC",
      bucketName: BUCKET,
      storageFolder: CREATOR_VIDEO_FOLDER,
    });
  },

  async uploadThumbnail(file): Promise<UploadThumbnailResult> {
    checkAvailable();
    const storagePath = generateStoragePath(CREATOR_THUMB_FOLDER, file.originalname);
    logger.info({ bucket: BUCKET, path: storagePath, size: file.size }, "PublicStorage[Creator]: upload thumbnail START");
    const { path: savedPath, url } = await supabaseUploadWithRetry(
      client, PUBLIC_SUPABASE_URL, BUCKET, storagePath, file.buffer, file.mimetype,
    );
    logger.info({ path: savedPath }, "PublicStorage[Creator]: upload thumbnail SUCCESS");
    return makeSupabaseThumbnailResult({
      path: savedPath, url,
      storageProvider: "supabase_public",
      storageType: "PUBLIC",
      bucketName: BUCKET,
      storageFolder: CREATOR_THUMB_FOLDER,
    });
  },

  async deleteVideo(storagePath) { await supabaseDeleteFile(client, BUCKET, storagePath); },
  async deleteThumbnail(storagePath) { await supabaseDeleteFile(client, BUCKET, storagePath); },
};

// ── Verified Creator ──────────────────────────────────────────────────────────

const VC_VIDEO_FOLDER    = "public/verified-creator/videos";
const VC_THUMB_FOLDER    = "public/verified-creator/thumbnails";
const VC_PAYMENTS_FOLDER = "public/verified-creator/payments";

export const verifiedCreatorPublicStorage: StorageService = {
  async uploadVideo(file, _opts): Promise<UploadVideoResult> {
    checkAvailable();
    const storagePath = generateStoragePath(VC_VIDEO_FOLDER, file.originalname);
    logger.info({ bucket: BUCKET, path: storagePath, size: file.size }, "PublicStorage[VerifiedCreator]: upload video START");
    const { path: savedPath, url } = await supabaseUploadWithRetry(
      client, PUBLIC_SUPABASE_URL, BUCKET, storagePath, file.buffer, file.mimetype,
    );
    logger.info({ path: savedPath }, "PublicStorage[VerifiedCreator]: upload video SUCCESS");
    return makeSupabaseVideoResult({
      path: savedPath, url,
      storageProvider: "supabase_public",
      storageType: "PUBLIC",
      bucketName: BUCKET,
      storageFolder: VC_VIDEO_FOLDER,
    });
  },

  async uploadThumbnail(file): Promise<UploadThumbnailResult> {
    checkAvailable();
    const storagePath = generateStoragePath(VC_THUMB_FOLDER, file.originalname);
    logger.info({ bucket: BUCKET, path: storagePath, size: file.size }, "PublicStorage[VerifiedCreator]: upload thumbnail START");
    const { path: savedPath, url } = await supabaseUploadWithRetry(
      client, PUBLIC_SUPABASE_URL, BUCKET, storagePath, file.buffer, file.mimetype,
    );
    logger.info({ path: savedPath }, "PublicStorage[VerifiedCreator]: upload thumbnail SUCCESS");
    return makeSupabaseThumbnailResult({
      path: savedPath, url,
      storageProvider: "supabase_public",
      storageType: "PUBLIC",
      bucketName: BUCKET,
      storageFolder: VC_THUMB_FOLDER,
    });
  },

  async deleteVideo(storagePath) { await supabaseDeleteFile(client, BUCKET, storagePath); },
  async deleteThumbnail(storagePath) { await supabaseDeleteFile(client, BUCKET, storagePath); },
};

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
