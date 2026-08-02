/**
 * StorageService factory — resolves the correct storage provider
 * based on the uploader type badge.
 *
 * Usage:
 *   import { getStorageService } from "../lib/storage";
 *   const storage = getStorageService("creator");
 *   const result  = await storage.uploadVideo(file, { title: "My Video" });
 */

export { creatorStorage, isCreatorStorageAvailable } from "./creator";
export { verifiedCreatorStorage, isVerifiedCreatorStorageAvailable, uploadPaymentProof } from "./verified-creator";
export { ownerStorage, isBunnyStreamAvailable } from "./owner";
export type {
  StorageProvider,
  StorageService,
  UploadVideoResult,
  UploadThumbnailResult,
  UploadProofResult,
} from "./types";

import type { StorageService } from "./types";
import { creatorStorage } from "./creator";
import { verifiedCreatorStorage } from "./verified-creator";
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
 * Throws if the type is unknown.
 */
export function getStorageService(type: NormalizedUploaderType): StorageService {
  switch (type) {
    case "creator":          return creatorStorage;
    case "verified_creator": return verifiedCreatorStorage;
    case "owner":            return ownerStorage;
    default: {
      const _: never = type;
      throw new Error(`Unknown uploader type: ${_}`);
    }
  }
}
