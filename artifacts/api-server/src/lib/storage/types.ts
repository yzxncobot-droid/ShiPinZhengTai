/**
 * Storage service abstraction for multi-provider media uploads.
 *
 * Two providers (new architecture):
 *  - PublicStorage  → Supabase PUBLIC project  (Creator + Verified Creator)
 *  - OwnerStorage   → Supabase OWNER project   (Owner / Admin)
 *
 * Legacy provider values are kept so existing DB rows remain valid:
 *  - "supabase_creator"          → old Supabase Project 1
 *  - "supabase_verified_creator" → old Supabase Project 2
 *  - "bunny_stream"              → old Bunny Stream CDN
 *  - "legacy"                    → original single-Supabase bucket
 */

export type StorageProvider =
  | "supabase_public"           // NEW — Creator + Verified Creator → PUBLIC Supabase
  | "supabase_owner"            // NEW — Owner/Admin → OWNER Supabase
  | "supabase_creator"          // LEGACY — kept for existing DB rows
  | "supabase_verified_creator" // LEGACY — kept for existing DB rows
  | "bunny_stream"              // LEGACY — kept for existing DB rows
  | "legacy";

/** "PUBLIC" | "OWNER" — new field set on every new upload */
export type StorageType = "PUBLIC" | "OWNER";

export interface UploadVideoResult {
  /** Primary playback URL — stored as video_url in Neon */
  url: string;
  /** Storage-internal path (Supabase object path or Bunny videoId) */
  path: string;
  /** Which storage system was used */
  storageProvider: StorageProvider;
  /** HIGH-LEVEL storage type: PUBLIC (creator/verified_creator) or OWNER */
  storageType: StorageType;
  /** Bunny Stream video GUID (null for Supabase providers) */
  bunnyVideoId?: string | null;
  /** Bunny Stream embed/HLS playback URL */
  bunnyPlaybackUrl?: string | null;
  /** Bunny Stream library ID */
  bunnyLibraryId?: string | null;
  /** Supabase bucket name */
  bucketName?: string | null;
  /** Supabase sub-folder */
  storageFolder?: string | null;
}

export interface UploadThumbnailResult {
  url: string;
  path: string;
  storageProvider: StorageProvider;
  storageType: StorageType;
  bucketName?: string | null;
  storageFolder?: string | null;
}

export interface UploadProofResult {
  url: string;
  path: string;
  storageProvider: StorageProvider;
  storageType: StorageType;
  bucketName?: string | null;
  storageFolder?: string | null;
}

export interface StorageService {
  uploadVideo(
    file: Express.Multer.File,
    opts?: { title?: string },
  ): Promise<UploadVideoResult>;

  uploadThumbnail(file: Express.Multer.File): Promise<UploadThumbnailResult>;

  deleteVideo(pathOrId: string): Promise<void>;
  deleteThumbnail(path: string): Promise<void>;
}
