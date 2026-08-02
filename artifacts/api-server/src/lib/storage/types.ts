/**
 * Storage service abstraction for multi-provider media uploads.
 *
 * Three providers are supported:
 *  - CreatorStorage       → Supabase Project 1  (Creator badge)
 *  - VerifiedCreatorStorage → Supabase Project 2 (Verified Creator badge)
 *  - OwnerStorage         → Bunny Stream          (Owner badge)
 *
 * Legacy single-Supabase uploads continue using the original supabase.ts helpers
 * when no uploader type is specified (backward-compatible).
 */

export type StorageProvider =
  | "supabase_creator"
  | "supabase_verified_creator"
  | "bunny_stream"
  | "legacy";

export interface UploadVideoResult {
  /** Primary playback URL — stored as video_url in Neon */
  url: string;
  /** Storage-internal path (Supabase object path or Bunny videoId) */
  path: string;
  /** Which storage system was used */
  storageProvider: StorageProvider;
  /** Bunny Stream video GUID (null for Supabase providers) */
  bunnyVideoId?: string | null;
  /** Bunny Stream embed/HLS playback URL */
  bunnyPlaybackUrl?: string | null;
  /** Bunny Stream library ID */
  bunnyLibraryId?: string | null;
  /** Supabase bucket name (null for Bunny) */
  bucketName?: string | null;
  /** Supabase sub-folder (null for Bunny) */
  storageFolder?: string | null;
}

export interface UploadThumbnailResult {
  url: string;
  path: string;
  storageProvider: StorageProvider;
  bucketName?: string | null;
  storageFolder?: string | null;
}

export interface UploadProofResult {
  url: string;
  path: string;
  storageProvider: StorageProvider;
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
