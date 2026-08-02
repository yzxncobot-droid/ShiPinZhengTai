/**
 * OwnerStorage — Bunny Stream
 *
 * Environment variables:
 *   BUNNY_STREAM_LIBRARY_ID  (required — Bunny Stream library ID)
 *   BUNNY_STREAM_API_KEY     (required — Bunny Stream API key / AccessKey)
 *   BUNNY_CDN_HOSTNAME       (optional — pull-zone hostname for HLS URLs,
 *                             e.g. "vz-abc123.b-cdn.net". Falls back to embed URL.)
 *
 * Thumbnails for Owner uploads fall back to the legacy Supabase bucket (SUPABASE_URL)
 * since Bunny Stream does not host static images. Owner thumbnails land in
 * yzx/owner/thumbnails/ of the legacy Supabase project.
 *
 * Bunny Stream API reference: https://docs.bunny.net/reference/video_uploadvideo
 */

import { logger } from "../logger";
import type { StorageService, UploadThumbnailResult, UploadVideoResult } from "./types";
import {
  buildSupabaseClient,
  generateStoragePath,
  makeSupabaseThumbnailResult,
  supabaseDeleteFile,
  supabaseUploadWithRetry,
} from "./supabase-helpers";

const BUNNY_LIBRARY_ID = process.env.BUNNY_STREAM_LIBRARY_ID ?? "";
const BUNNY_API_KEY    = process.env.BUNNY_STREAM_API_KEY    ?? "";
const BUNNY_CDN_HOST   = process.env.BUNNY_CDN_HOSTNAME      ?? "";

// Legacy Supabase for Owner thumbnails (same project used by pre-storage-split uploads)
const LEGACY_SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const LEGACY_SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const THUMB_BUCKET        = "yzx";
const THUMB_FOLDER        = "owner/thumbnails";

export const isBunnyStreamAvailable = !!BUNNY_LIBRARY_ID && !!BUNNY_API_KEY;

if (!isBunnyStreamAvailable) {
  logger.warn(
    "BUNNY_STREAM_LIBRARY_ID / BUNNY_STREAM_API_KEY not set — " +
    "Owner video uploads will fail. Set these secrets to enable Bunny Stream.",
  );
}

const BUNNY_BASE = "https://video.bunnycdn.com";

function checkAvailable() {
  if (!isBunnyStreamAvailable) {
    throw new Error(
      "Bunny Stream tidak dikonfigurasi " +
      "(BUNNY_STREAM_LIBRARY_ID / BUNNY_STREAM_API_KEY belum diset). " +
      "Hubungi admin untuk mengaktifkan Owner upload.",
    );
  }
}

/** Build the primary playback URL for a Bunny video */
function buildPlaybackUrl(videoId: string): string {
  if (BUNNY_CDN_HOST) {
    // HLS playlist via pull-zone CDN — playable directly by video players with HLS support
    return `https://${BUNNY_CDN_HOST}/${videoId}/playlist.m3u8`;
  }
  // Fallback: Bunny embed player URL (works anywhere in an <iframe>)
  return `https://iframe.mediadelivery.net/play/${BUNNY_LIBRARY_ID}/${videoId}`;
}

/** Build the Bunny embed player URL (for display in embedded players) */
function buildEmbedUrl(videoId: string): string {
  return `https://iframe.mediadelivery.net/embed/${BUNNY_LIBRARY_ID}/${videoId}`;
}

/**
 * Create a video entry in Bunny Stream and upload the file buffer.
 * Returns the Bunny videoId + playback URLs.
 */
async function bunnyUploadVideo(
  buffer: Buffer,
  title: string,
  contentType: string,
): Promise<{ videoId: string; playbackUrl: string; embedUrl: string }> {
  // Step 1: Create the video shell
  const createRes = await fetch(`${BUNNY_BASE}/library/${BUNNY_LIBRARY_ID}/videos`, {
    method: "POST",
    headers: {
      "AccessKey": BUNNY_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title }),
  });

  if (!createRes.ok) {
    const body = await createRes.text().catch(() => "");
    throw new Error(
      `Bunny Stream: gagal membuat video entry (${createRes.status}). ` +
      (body ? `Detail: ${body.slice(0, 200)}` : ""),
    );
  }

  const created = await createRes.json() as { guid?: string; VideoId?: string };
  const videoId = created.guid ?? (created as any).videoId ?? (created as any).VideoId;
  if (!videoId) {
    throw new Error("Bunny Stream: response tidak memiliki video GUID. Periksa API key dan library ID.");
  }

  // Step 2: Upload the video binary
  const uploadRes = await fetch(`${BUNNY_BASE}/library/${BUNNY_LIBRARY_ID}/videos/${videoId}`, {
    method: "PUT",
    headers: {
      "AccessKey": BUNNY_API_KEY,
      "Content-Type": "application/octet-stream",
    },
    body: buffer,
  });

  if (!uploadRes.ok) {
    const body = await uploadRes.text().catch(() => "");
    // Best-effort cleanup: delete the created shell
    await fetch(`${BUNNY_BASE}/library/${BUNNY_LIBRARY_ID}/videos/${videoId}`, {
      method: "DELETE",
      headers: { "AccessKey": BUNNY_API_KEY },
    }).catch(() => {});
    throw new Error(
      `Bunny Stream: gagal mengupload video (${uploadRes.status}). ` +
      (body ? `Detail: ${body.slice(0, 200)}` : ""),
    );
  }

  return {
    videoId,
    playbackUrl: buildPlaybackUrl(videoId),
    embedUrl: buildEmbedUrl(videoId),
  };
}

/** Delete a video from Bunny Stream by videoId */
async function bunnyDeleteVideo(videoId: string): Promise<void> {
  const res = await fetch(`${BUNNY_BASE}/library/${BUNNY_LIBRARY_ID}/videos/${videoId}`, {
    method: "DELETE",
    headers: { "AccessKey": BUNNY_API_KEY },
  });
  if (!res.ok) {
    logger.warn({ videoId, status: res.status }, "Bunny Stream: delete failed (non-fatal)");
  }
}

// Legacy Supabase client for Owner thumbnails
const legacyClient = buildSupabaseClient(LEGACY_SUPABASE_URL, LEGACY_SUPABASE_KEY);

export const ownerStorage: StorageService = {
  async uploadVideo(file, opts): Promise<UploadVideoResult> {
    checkAvailable();
    const title = opts?.title ?? file.originalname ?? "Owner Upload";
    logger.info({ libraryId: BUNNY_LIBRARY_ID, size: file.size, title }, "OwnerStorage: Bunny upload START");

    const { videoId, playbackUrl, embedUrl } = await bunnyUploadVideo(
      file.buffer,
      title,
      file.mimetype,
    );

    logger.info({ videoId, playbackUrl }, "OwnerStorage: Bunny upload SUCCESS");

    return {
      url: playbackUrl,
      path: videoId, // For Bunny, the "path" is the video GUID
      storageProvider: "bunny_stream",
      bunnyVideoId: videoId,
      bunnyPlaybackUrl: embedUrl,
      bunnyLibraryId: BUNNY_LIBRARY_ID,
      bucketName: null,
      storageFolder: null,
    };
  },

  async uploadThumbnail(file): Promise<UploadThumbnailResult> {
    // Owner thumbnails go to the legacy Supabase bucket (yzx/owner/thumbnails/)
    if (!LEGACY_SUPABASE_URL || !LEGACY_SUPABASE_KEY) {
      throw new Error(
        "Thumbnail storage untuk Owner tidak tersedia " +
        "(SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum diset).",
      );
    }
    const storagePath = generateStoragePath(THUMB_FOLDER, file.originalname);
    logger.info({ bucket: THUMB_BUCKET, path: storagePath, size: file.size }, "OwnerStorage: upload thumbnail START");
    const { path: savedPath, url } = await supabaseUploadWithRetry(
      legacyClient, LEGACY_SUPABASE_URL, THUMB_BUCKET, storagePath, file.buffer, file.mimetype,
    );
    logger.info({ path: savedPath }, "OwnerStorage: upload thumbnail SUCCESS");
    return makeSupabaseThumbnailResult({
      path: savedPath, url,
      storageProvider: "bunny_stream", // Owner storage provider (video is Bunny, thumb is Supabase)
      bucketName: THUMB_BUCKET,
      storageFolder: THUMB_FOLDER,
    });
  },

  async deleteVideo(videoId) {
    // videoId is the Bunny GUID stored in the `path` field
    await bunnyDeleteVideo(videoId);
  },

  async deleteThumbnail(storagePath) {
    await supabaseDeleteFile(legacyClient, THUMB_BUCKET, storagePath);
  },
};
