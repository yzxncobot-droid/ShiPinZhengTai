/**
 * MediaStorage — Supabase MEDIA project
 *
 * Dedicated storage for all non-video media assets:
 *   Profile photos (avatars)
 *   QRIS payment images
 *   Banners (site, user, category)
 *   Bundle thumbnails & banners
 *   Site logos / generic images
 *
 * Environment variables:
 *   MEDIA_SUPABASE_URL         (required)
 *   MEDIA_SUPABASE_SERVICE_KEY (required)
 *
 * Bucket: yzx  (configurable via MEDIA_SUPABASE_BUCKET)
 * Folder layout:
 *   media/avatars/           ← profile photos
 *   media/qris/              ← QRIS payment images
 *   media/banners/           ← site / user / category banners
 *   media/bundle-thumbnails/ ← bundle cover images
 *   media/bundle-banners/    ← bundle banner images
 *   media/logos/             ← site logos & favicons
 *   media/images/            ← generic fallback
 */

import { logger } from "../logger";
import {
  buildSupabaseClient,
  generateStoragePath,
  supabaseUploadWithRetry,
} from "./supabase-helpers";

const MEDIA_URL = process.env.MEDIA_SUPABASE_URL ?? "";
const MEDIA_KEY = process.env.MEDIA_SUPABASE_SERVICE_KEY ?? "";
const BUCKET    = process.env.MEDIA_SUPABASE_BUCKET ?? "yzx";

export const isMediaStorageAvailable = !!MEDIA_URL && !!MEDIA_KEY;

if (!isMediaStorageAvailable) {
  logger.warn(
    "MEDIA_SUPABASE_URL / MEDIA_SUPABASE_SERVICE_KEY not set — " +
    "media asset uploads (avatars, QRIS, banners, bundle images) will fail.",
  );
}

const client = buildSupabaseClient(MEDIA_URL, MEDIA_KEY);

function checkAvailable() {
  if (!isMediaStorageAvailable) {
    throw new Error(
      "Media storage tidak dikonfigurasi " +
      "(MEDIA_SUPABASE_URL / MEDIA_SUPABASE_SERVICE_KEY belum diset). " +
      "Hubungi admin untuk mengaktifkan upload media.",
    );
  }
}

// ── Asset type → folder mapping ───────────────────────────────────────────────

export type MediaAssetType =
  | "avatar"
  | "qris"
  | "banner"
  | "bundle-thumbnail"
  | "bundle-banner"
  | "logo"
  | "images"
  | "home-feed-video"
  | "home-feed-thumbnail"
  | "chat-image"
  | "chat-video"
  | "chat-voice"
  | "chat-file";

const ASSET_FOLDER: Record<MediaAssetType, string> = {
  "avatar":              "media/avatars",
  "qris":                "media/qris",
  "banner":              "media/banners",
  "bundle-thumbnail":    "media/bundle-thumbnails",
  "bundle-banner":       "media/bundle-banners",
  "logo":                "media/logos",
  "images":              "media/images",
  "home-feed-video":     "media/home-feed/videos",
  "home-feed-thumbnail": "media/home-feed/thumbnails",
  "chat-image":          "media/chat/images",
  "chat-video":          "media/chat/videos",
  "chat-voice":          "media/chat/voice",
  "chat-file":           "media/chat/files",
};

/**
 * Normalise an assetType string coming from a request body.
 * Accepts the frontend field-name aliases ("qrisImage", "thumbnail", etc.)
 * as well as the canonical MediaAssetType values.
 * Falls back to "images" for unknown/missing values.
 */
export function resolveMediaAssetType(raw: string | undefined): MediaAssetType {
  if (!raw) return "images";
  const s = raw.trim().toLowerCase();
  // canonical values
  if (s === "avatar")           return "avatar";
  if (s === "qris")             return "qris";
  if (s === "banner")           return "banner";
  if (s === "bundle-thumbnail") return "bundle-thumbnail";
  if (s === "bundle-banner")    return "bundle-banner";
  if (s === "logo")             return "logo";
  // chat asset aliases
  if (s === "chat-image")       return "chat-image";
  if (s === "chat-video")       return "chat-video";
  if (s === "chat-voice")       return "chat-voice";
  if (s === "chat-file")        return "chat-file";
  // frontend field-name aliases
  if (s === "qrisimage")        return "qris";
  if (s === "thumbnail")        return "bundle-thumbnail";
  return "images";
}

// ── Upload helper ─────────────────────────────────────────────────────────────

/**
 * Upload any media asset to the MEDIA Supabase project.
 *
 * @param assetType  One of the MediaAssetType values (or a frontend alias).
 *                   Determines the sub-folder inside the bucket.
 * @param file       Multer file from the request.
 * @returns          { path, url, folder }
 */
export async function uploadToMediaStorage(
  assetType: string | undefined,
  file: Express.Multer.File,
): Promise<{ path: string; url: string; folder: string }> {
  checkAvailable();

  const type   = resolveMediaAssetType(assetType);
  const folder = ASSET_FOLDER[type];
  const storagePath = generateStoragePath(folder, file.originalname);

  logger.info(
    { bucket: BUCKET, folder, path: storagePath, size: file.size, assetType: type },
    "MediaStorage: upload START",
  );

  const { path: savedPath, url } = await supabaseUploadWithRetry(
    client, MEDIA_URL, BUCKET, storagePath, file.buffer, file.mimetype,
  );

  logger.info({ path: savedPath, assetType: type }, "MediaStorage: upload SUCCESS");

  return { path: savedPath, url, folder };
}

/**
 * Convenience wrapper specifically for bundle thumbnails.
 * Always routes to media/bundle-thumbnails/.
 */
export async function uploadBundleThumbnailToMedia(
  file: Express.Multer.File,
): Promise<{ path: string; url: string; folder: string }> {
  return uploadToMediaStorage("bundle-thumbnail", file);
}

/**
 * Convenience wrapper specifically for bundle banners.
 */
export async function uploadBundleBannerToMedia(
  file: Express.Multer.File,
): Promise<{ path: string; url: string; folder: string }> {
  return uploadToMediaStorage("bundle-banner", file);
}
