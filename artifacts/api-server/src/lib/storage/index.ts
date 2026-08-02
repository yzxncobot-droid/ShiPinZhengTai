/**
 * StorageService factory — resolves the correct storage provider
 * based on the uploader type.
 *
 * NEW architecture (2 Supabase projects):
 *   creator          → PublicStorage  (PUBLIC_SUPABASE_URL)
 *   verified_creator → PublicStorage  (PUBLIC_SUPABASE_URL)
 *   owner            → OwnerStorage   (OWNER_SUPABASE_URL)
 *
 * Usage:
 *   import { getStorageService } from "../lib/storage";
 *   const storage = getStorageService("creator");
 *   const result  = await storage.uploadVideo(file, { title: "My Video" });
 */

export {
  creatorPublicStorage,
  verifiedCreatorPublicStorage,
  isPublicStorageAvailable,
  uploadPublicPaymentProof,
  uploadToPublicBucket,
} from "./public";
export { ownerStorage, isOwnerStorageAvailable, isBunnyStreamAvailable } from "./owner";
export {
  isMediaStorageAvailable,
  uploadToMediaStorage,
  uploadBundleThumbnailToMedia,
  uploadBundleBannerToMedia,
  resolveMediaAssetType,
  type MediaAssetType,
} from "./media";
export type {
  StorageProvider,
  StorageType,
  StorageService,
  UploadVideoResult,
  UploadThumbnailResult,
  UploadProofResult,
} from "./types";

import type { StorageService } from "./types";
import { creatorPublicStorage, verifiedCreatorPublicStorage } from "./public";
import { ownerStorage } from "./owner";

export type NormalizedUploaderType = "creator" | "verified_creator" | "owner";

/**
 * Normalize a raw uploader type string from the request body.
 * Accepts "Creator", "Verified Creator", "Owner" (UI values)
 * as well as the snake_case DB values.
 * Returns null for unknown/missing types (falls back to legacy storage).
 */
export function normalizeUploaderType(raw: string | undefined): NormalizedUploaderType | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase().replace(/\s+/g, "_");
  if (s === "creator") return "creator";
  if (s === "verified_creator") return "verified_creator";
  if (s === "owner") return "owner";
  return null;
}

/**
 * Returns the StorageService for the given uploader type.
 *
 *   creator          → PUBLIC Supabase
 *   verified_creator → PUBLIC Supabase
 *   owner            → OWNER Supabase
 */
export function getStorageService(type: NormalizedUploaderType): StorageService {
  switch (type) {
    case "creator":          return creatorPublicStorage;
    case "verified_creator": return verifiedCreatorPublicStorage;
    case "owner":            return ownerStorage;
    default: {
      const _: never = type;
      throw new Error(`Unknown uploader type: ${_}`);
    }
  }
}

/**
 * Resolve the storage_type string ("PUBLIC" | "OWNER") for a given uploader type.
 */
export function resolveStorageType(type: NormalizedUploaderType): "PUBLIC" | "OWNER" {
  return type === "owner" ? "OWNER" : "PUBLIC";
}

// Re-export payment proof helper under the old name for backward compat in upload.ts
export { uploadPublicPaymentProof as uploadPaymentProof } from "./public";

// Legacy availability flags — kept for backward compat
export { isPublicStorageAvailable as isCreatorStorageAvailable } from "./public";
export { isPublicStorageAvailable as isVerifiedCreatorStorageAvailable } from "./public";
