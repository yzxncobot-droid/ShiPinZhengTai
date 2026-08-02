/**
 * VerifiedCreatorStorage — Supabase Project 2
 *
 * Environment variables:
 *   VERIFIED_CREATOR_SUPABASE_URL              (required for Verified Creator uploads)
 *   VERIFIED_CREATOR_SUPABASE_SERVICE_ROLE_KEY (required for Verified Creator uploads)
 *
 * Bucket: yzx
 * Folders:
 *   Videos:        yzx/verified-creator/videos/
 *   Thumbnails:    yzx/verified-creator/thumbnails/
 *   Payment proofs: yzx/verified-creator/payments/  ← always routed here
 */

import { logger } from "../logger";
import type { StorageService, UploadProofResult, UploadThumbnailResult, UploadVideoResult } from "./types";
import {
  buildSupabaseClient,
  generateStoragePath,
  makeSupabaseThumbnailResult,
  makeSupabaseVideoResult,
  supabaseDeleteFile,
  supabaseUploadWithRetry,
} from "./supabase-helpers";

const VC_SUPABASE_URL = process.env.VERIFIED_CREATOR_SUPABASE_URL ?? "";
const VC_SUPABASE_KEY = process.env.VERIFIED_CREATOR_SUPABASE_SERVICE_ROLE_KEY ?? "";
const BUCKET = "yzx";
const VIDEO_FOLDER = "verified-creator/videos";
const THUMB_FOLDER = "verified-creator/thumbnails";
const PAYMENTS_FOLDER = "verified-creator/payments";

export const isVerifiedCreatorStorageAvailable =
  !!VC_SUPABASE_URL && !!VC_SUPABASE_KEY;

if (!isVerifiedCreatorStorageAvailable) {
  logger.warn(
    "VERIFIED_CREATOR_SUPABASE_URL / VERIFIED_CREATOR_SUPABASE_SERVICE_ROLE_KEY not set — " +
    "Verified Creator uploads will fail. Set these secrets to enable Verified Creator storage.",
  );
}

const client = buildSupabaseClient(VC_SUPABASE_URL, VC_SUPABASE_KEY);

function checkAvailable() {
  if (!isVerifiedCreatorStorageAvailable) {
    throw new Error(
      "Verified Creator storage tidak dikonfigurasi " +
      "(VERIFIED_CREATOR_SUPABASE_URL / VERIFIED_CREATOR_SUPABASE_SERVICE_ROLE_KEY belum diset). " +
      "Hubungi admin untuk mengaktifkan Verified Creator upload.",
    );
  }
}

export const verifiedCreatorStorage: StorageService = {
  async uploadVideo(file, _opts): Promise<UploadVideoResult> {
    checkAvailable();
    const storagePath = generateStoragePath(VIDEO_FOLDER, file.originalname);
    logger.info({ bucket: BUCKET, path: storagePath, size: file.size }, "VerifiedCreatorStorage: upload video START");
    const { path: savedPath, url } = await supabaseUploadWithRetry(
      client, VC_SUPABASE_URL, BUCKET, storagePath, file.buffer, file.mimetype,
    );
    logger.info({ path: savedPath }, "VerifiedCreatorStorage: upload video SUCCESS");
    return makeSupabaseVideoResult({
      path: savedPath, url,
      storageProvider: "supabase_verified_creator",
      bucketName: BUCKET,
      storageFolder: VIDEO_FOLDER,
    });
  },

  async uploadThumbnail(file): Promise<UploadThumbnailResult> {
    checkAvailable();
    const storagePath = generateStoragePath(THUMB_FOLDER, file.originalname);
    logger.info({ bucket: BUCKET, path: storagePath, size: file.size }, "VerifiedCreatorStorage: upload thumbnail START");
    const { path: savedPath, url } = await supabaseUploadWithRetry(
      client, VC_SUPABASE_URL, BUCKET, storagePath, file.buffer, file.mimetype,
    );
    logger.info({ path: savedPath }, "VerifiedCreatorStorage: upload thumbnail SUCCESS");
    return makeSupabaseThumbnailResult({
      path: savedPath, url,
      storageProvider: "supabase_verified_creator",
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

/**
 * Upload a payment proof file — always goes to yzx/verified-creator/payments/{userId}/
 * in Supabase Project 2. This is a standalone export (not on the StorageService interface)
 * because it's specific to Verified Creator and takes a userId for path namespacing.
 */
export async function uploadPaymentProof(
  file: Express.Multer.File,
  userId: string,
): Promise<UploadProofResult> {
  checkAvailable();
  const ext = require("path").extname(file.originalname).toLowerCase() || ".jpg";
  const storagePath = `${PAYMENTS_FOLDER}/${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
  logger.info({ bucket: BUCKET, path: storagePath, size: file.size, userId }, "VerifiedCreatorStorage: upload payment-proof START");
  const { path: savedPath, url } = await supabaseUploadWithRetry(
    client, VC_SUPABASE_URL, BUCKET, storagePath, file.buffer, file.mimetype,
  );
  logger.info({ path: savedPath }, "VerifiedCreatorStorage: upload payment-proof SUCCESS");
  return {
    url,
    path: savedPath,
    storageProvider: "supabase_verified_creator",
    bucketName: BUCKET,
    storageFolder: PAYMENTS_FOLDER,
  };
}
