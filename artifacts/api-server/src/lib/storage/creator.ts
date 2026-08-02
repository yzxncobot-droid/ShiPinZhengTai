/**
 * CreatorStorage — Supabase Project 1
 *
 * Environment variables:
 *   CREATOR_SUPABASE_URL              (required for Creator uploads)
 *   CREATOR_SUPABASE_SERVICE_ROLE_KEY (required for Creator uploads)
 *
 * Bucket: yzx
 * Folders:
 *   Videos:     yzx/creator/videos/
 *   Thumbnails: yzx/creator/thumbnails/
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

const CREATOR_SUPABASE_URL = process.env.CREATOR_SUPABASE_URL ?? "";
const CREATOR_SUPABASE_KEY = process.env.CREATOR_SUPABASE_SERVICE_ROLE_KEY ?? "";
const BUCKET = "yzx";
const VIDEO_FOLDER = "creator/videos";
const THUMB_FOLDER = "creator/thumbnails";

export const isCreatorStorageAvailable =
  !!CREATOR_SUPABASE_URL && !!CREATOR_SUPABASE_KEY;

if (!isCreatorStorageAvailable) {
  logger.warn(
    "CREATOR_SUPABASE_URL / CREATOR_SUPABASE_SERVICE_ROLE_KEY not set — " +
    "Creator uploads will fail. Set these secrets to enable Creator storage.",
  );
}

const client = buildSupabaseClient(CREATOR_SUPABASE_URL, CREATOR_SUPABASE_KEY);

function checkAvailable() {
  if (!isCreatorStorageAvailable) {
    throw new Error(
      "Creator storage tidak dikonfigurasi " +
      "(CREATOR_SUPABASE_URL / CREATOR_SUPABASE_SERVICE_ROLE_KEY belum diset). " +
      "Hubungi admin untuk mengaktifkan Creator upload.",
    );
  }
}

export const creatorStorage: StorageService = {
  async uploadVideo(file, _opts) {
    checkAvailable();
    const storagePath = generateStoragePath(VIDEO_FOLDER, file.originalname);
    logger.info({ bucket: BUCKET, path: storagePath, size: file.size }, "CreatorStorage: upload video START");
    const { path: savedPath, url } = await supabaseUploadWithRetry(
      client, CREATOR_SUPABASE_URL, BUCKET, storagePath, file.buffer, file.mimetype,
    );
    logger.info({ path: savedPath }, "CreatorStorage: upload video SUCCESS");
    return makeSupabaseVideoResult({
      path: savedPath, url,
      storageProvider: "supabase_creator",
      bucketName: BUCKET,
      storageFolder: VIDEO_FOLDER,
    });
  },

  async uploadThumbnail(file): Promise<UploadThumbnailResult> {
    checkAvailable();
    const storagePath = generateStoragePath(THUMB_FOLDER, file.originalname);
    logger.info({ bucket: BUCKET, path: storagePath, size: file.size }, "CreatorStorage: upload thumbnail START");
    const { path: savedPath, url } = await supabaseUploadWithRetry(
      client, CREATOR_SUPABASE_URL, BUCKET, storagePath, file.buffer, file.mimetype,
    );
    logger.info({ path: savedPath }, "CreatorStorage: upload thumbnail SUCCESS");
    return makeSupabaseThumbnailResult({
      path: savedPath, url,
      storageProvider: "supabase_creator",
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
