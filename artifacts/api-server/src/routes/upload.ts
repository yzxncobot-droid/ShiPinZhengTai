import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import path from "path";
import { authenticate } from "../middlewares/auth";
import {
  // Legacy Supabase (for backward-compat uploads without uploader type,
  // bundle videos, bundle thumbnails, generic images)
  supabase, MEDIA_BUCKET,
  FOLDER_VIDEOS, FOLDER_THUMBNAILS, FOLDER_IMAGES, FOLDER_PAYMENTS,
  FOLDER_BUNDLES, FOLDER_BUNDLE_THUMBNAILS,
  getPublicUrl, uploadWithRetry,
  isSupabaseAvailable,
} from "../lib/supabase";
import {
  getStorageService,
  normalizeUploaderType,
  uploadPaymentProof,
  isCreatorStorageAvailable,
  isVerifiedCreatorStorageAvailable,
  isOwnerStorageAvailable,
  isBunnyStreamAvailable,
  resolveStorageType,
} from "../lib/storage";
import type { UploadVideoResult, UploadThumbnailResult } from "../lib/storage";
import { logger } from "../lib/logger";

const router = Router();

// ── Limits & allowed formats ─────────────────────────────────────────────────
const MAX_VIDEO_SIZE = 500 * 1024 * 1024; // 500 MB
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;  // 10 MB

const ALLOWED_VIDEO_MIMES = ["video/mp4", "video/webm", "video/quicktime"];
const ALLOWED_VIDEO_EXT  = [".mp4", ".webm", ".mov"];
const ALLOWED_IMAGE_MIMES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const ALLOWED_IMAGE_EXT  = [".jpg", ".jpeg", ".png", ".webp"];

function extOf(filename: string): string {
  return path.extname(filename).toLowerCase();
}

// All uploads use memory storage — nothing ever touches local disk.
const videoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_VIDEO_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_VIDEO_MIMES.includes(file.mimetype) || ALLOWED_VIDEO_EXT.includes(extOf(file.originalname))) {
      cb(null, true);
    } else {
      cb(new Error("FORMAT_NOT_SUPPORTED: Format video tidak didukung. Gunakan MP4, WebM, atau MOV."));
    }
  },
});

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_MIMES.includes(file.mimetype) || ALLOWED_IMAGE_EXT.includes(extOf(file.originalname))) {
      cb(null, true);
    } else {
      cb(new Error("FORMAT_NOT_SUPPORTED: Format gambar tidak didukung. Gunakan JPG, JPEG, PNG, atau WEBP."));
    }
  },
});

/**
 * Wraps a multer middleware so every failure becomes a clean JSON response
 * instead of Express's default HTML error page.
 */
function withMulterErrorHandling(
  middleware: (req: Request, res: Response, cb: (err: any) => void) => void,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    middleware(req, res, (err: any) => {
      if (!err) { next(); return; }

      if (err instanceof multer.MulterError) {
        logger.error({ code: err.code, field: err.field }, "Multer upload error");
        if (err.code === "LIMIT_FILE_SIZE") {
          res.status(413).json({ success: false, message: "Ukuran file melebihi batas maksimum yang diizinkan." });
          return;
        }
        if (err.code === "LIMIT_UNEXPECTED_FILE") {
          res.status(400).json({
            success: false,
            message: `Field upload tidak dikenali ("${err.field}"). Gunakan field "video" untuk video dan "thumbnail" untuk thumbnail.`,
          });
          return;
        }
        res.status(400).json({ success: false, message: "Upload gagal." });
        return;
      }

      if (err instanceof Error && err.message.startsWith("FORMAT_NOT_SUPPORTED")) {
        res.status(415).json({ success: false, message: err.message.replace("FORMAT_NOT_SUPPORTED: ", "") });
        return;
      }

      logger.error({ err }, "Unexpected upload middleware error");
      res.status(500).json({ success: false, message: "Upload gagal." });
    });
  };
}

/** Build a user-friendly error message from a storage error. */
function friendlyUploadError(err: any, context: string): string {
  const msg = (err?.message ?? "").toLowerCase();
  if (msg.includes("bucket") && msg.includes("not found")) {
    return `Bucket tidak ditemukan (${context}). Pastikan bucket sudah dibuat di Supabase Storage.`;
  }
  if (msg.includes("permission") || msg.includes("policy") || msg.includes("violates") || msg.includes("denied")) {
    return `Akses ditolak oleh storage (${context}). Periksa RLS policy atau API key.`;
  }
  if (msg.includes("already exists") || msg.includes("duplicate")) {
    return "File dengan nama yang sama sudah ada. Silakan coba lagi.";
  }
  if (msg.includes("too large") || msg.includes("size")) {
    return "File terlalu besar menurut konfigurasi storage.";
  }
  if (msg.includes("network") || msg.includes("fetch") || msg.includes("timeout")) {
    return "Gagal menghubungi storage. Periksa koneksi server.";
  }
  if (msg.includes("tidak dikonfigurasi") || msg.includes("belum diset") || msg.includes("not configured")) {
    return err.message; // Already user-friendly (from our own storage services)
  }
  if (msg.includes("gagal") || msg.includes("failed") || msg.includes("bunny")) {
    return err.message.length < 300 ? err.message : `Upload gagal (${context}): error tidak terduga.`;
  }
  return `Upload gagal (${context}): ${err?.message ?? "Unknown error"}`;
}

/** Streams a multer memory-storage file buffer into the legacy media bucket under `folder/`. */
async function uploadToLegacyBucket(folder: string, file: Express.Multer.File) {
  const ext = extOf(file.originalname);
  const filename = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
  logger.info({ bucket: MEDIA_BUCKET, folder, filename, size: file.size }, "UPLOAD START (legacy)");
  try {
    const result = await uploadWithRetry(MEDIA_BUCKET, filename, file.buffer, file.mimetype, { upsert: false });
    logger.info({ bucket: MEDIA_BUCKET, folder, path: result.path }, "UPLOAD SUCCESS (legacy)");
    return result;
  } catch (err: any) {
    logger.error({ bucket: MEDIA_BUCKET, folder, filename, err: err?.message }, "UPLOAD ERROR (legacy)");
    throw err;
  }
}

// ── Video upload ──────────────────────────────────────────────────────────────
//
//  Routing logic based on uploaderType:
//    "Creator"          → CreatorStorage (Supabase Project 1 → yzx/creator/videos/)
//    "Verified Creator" → VerifiedCreatorStorage (Supabase Project 2 → yzx/verified-creator/videos/)
//    "Owner"            → OwnerStorage (Bunny Stream — returns playback URL)
//    (omitted)          → Legacy Supabase (yzx/videos/ — backward-compatible)
//
router.post(
  "/upload/video",
  authenticate,
  withMulterErrorHandling((req, res, cb) => videoUpload.single("video")(req, res, cb)),
  async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ success: false, message: "Tidak ada file video yang dipilih." });
      return;
    }

    const rawUploaderType = req.body?.uploaderType as string | undefined;
    const normalized = normalizeUploaderType(rawUploaderType);

    // ── Multi-storage route (Creator / Verified Creator / Owner) ──────────────
    if (normalized) {
      // Server-side role enforcement: OWNER storage requires admin or owner role.
      // Do NOT trust the client-supplied uploaderType for authorization —
      // validate against the authenticated user's resolved role.
      if (normalized === "owner") {
        const userRole = req.user?.role ?? "";
        if (!["admin", "owner"].includes(userRole)) {
          return res.status(403).json({
            success: false,
            message: "Hanya admin atau owner yang dapat mengupload ke OWNER storage.",
          });
        }
      }

      const storage = getStorageService(normalized);
      const title   = req.body?.title ?? req.file.originalname ?? "Upload";
      try {
        const result: UploadVideoResult = await storage.uploadVideo(req.file, { title });
        return res.json({
          success: true,
          url:               result.url,
          path:              result.path,
          filename:          result.path,
          size:              req.file.size,
          storageProvider:   result.storageProvider,
          storageType:       result.storageType,
          storageFolder:     result.storageFolder ?? null,
          bucketName:        result.bucketName    ?? null,
          uploaderType:      normalized,
          // Bunny-specific (null for all new Supabase providers)
          bunnyVideoId:      result.bunnyVideoId      ?? null,
          bunnyPlaybackUrl:  result.bunnyPlaybackUrl  ?? null,
          bunnyLibraryId:    result.bunnyLibraryId    ?? null,
          // videoSourceType hint for the frontend
          videoSourceType:   "upload",
        });
      } catch (err: any) {
        logger.error({ uploaderType: normalized, err }, "Video upload failed (multi-storage)");
        return res.status(500).json({
          success: false,
          message: friendlyUploadError(err, `${normalized} storage`),
          detail:  err?.message,
        });
      }
    }

    // ── Legacy route (no uploader type) ───────────────────────────────────────
    if (!isSupabaseAvailable) {
      return res.status(503).json({
        success: false,
        message: "Storage belum dikonfigurasi. Hubungi administrator.",
      });
    }
    try {
      const { path: storedPath, url } = await uploadToLegacyBucket(FOLDER_VIDEOS, req.file);
      return res.json({
        success: true,
        url,
        path: storedPath,
        filename: storedPath,
        size: req.file.size,
        storageProvider: "legacy",
        bucket: MEDIA_BUCKET,
        storageFolder: FOLDER_VIDEOS,
        uploaderType: null,
        bunnyVideoId: null,
        bunnyPlaybackUrl: null,
        bunnyLibraryId: null,
      });
    } catch (err: any) {
      logger.error({ folder: FOLDER_VIDEOS, err }, "Video upload failed (legacy)");
      return res.status(500).json({
        success: false,
        message: friendlyUploadError(err, `legacy/${FOLDER_VIDEOS}`),
        detail:  err?.message,
      });
    }
  },
);

// ── Thumbnail upload ──────────────────────────────────────────────────────────
//
//  Routing logic based on uploaderType (mirrors video upload):
//    "Creator"          → CreatorStorage      (yzx/creator/thumbnails/)
//    "Verified Creator" → VerifiedCreatorStorage (yzx/verified-creator/thumbnails/)
//    "Owner"            → OwnerStorage thumbnail (yzx/owner/thumbnails/ in legacy Supabase)
//    (omitted)          → Legacy Supabase     (yzx/thumnails/ — intentional typo compat)
//
router.post(
  "/upload/thumbnail",
  authenticate,
  withMulterErrorHandling((req, res, cb) => imageUpload.single("thumbnail")(req, res, cb)),
  async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ success: false, message: "Tidak ada file thumbnail yang dipilih." });
      return;
    }

    const rawUploaderType = req.body?.uploaderType as string | undefined;
    const normalized = normalizeUploaderType(rawUploaderType);

    // ── Multi-storage route ───────────────────────────────────────────────────
    if (normalized) {
      // Server-side role enforcement: OWNER storage requires admin or owner role.
      if (normalized === "owner") {
        const userRole = req.user?.role ?? "";
        if (!["admin", "owner"].includes(userRole)) {
          return res.status(403).json({
            success: false,
            message: "Hanya admin atau owner yang dapat mengupload ke OWNER storage.",
          });
        }
      }

      const storage = getStorageService(normalized);
      try {
        const result: UploadThumbnailResult = await storage.uploadThumbnail(req.file);
        return res.json({
          success: true,
          url:             result.url,
          path:            result.path,
          filename:        result.path,
          size:            req.file.size,
          storageProvider: result.storageProvider,
          storageType:     result.storageType,
          storageFolder:   result.storageFolder ?? null,
          bucketName:      result.bucketName    ?? null,
          uploaderType:    normalized,
        });
      } catch (err: any) {
        logger.error({ uploaderType: normalized, err }, "Thumbnail upload failed (multi-storage)");
        return res.status(500).json({
          success: false,
          message: friendlyUploadError(err, `${normalized} thumbnail`),
          detail:  err?.message,
        });
      }
    }

    // ── Legacy route ──────────────────────────────────────────────────────────
    if (!isSupabaseAvailable) {
      return res.status(503).json({
        success: false,
        message: "Storage belum dikonfigurasi. Hubungi administrator.",
      });
    }
    try {
      const { path: storedPath, url } = await uploadToLegacyBucket(FOLDER_THUMBNAILS, req.file);
      return res.json({
        success: true,
        url,
        path: storedPath,
        filename: storedPath,
        size: req.file.size,
        storageProvider: "legacy",
        bucket: MEDIA_BUCKET,
        storageFolder: FOLDER_THUMBNAILS,
        uploaderType: null,
      });
    } catch (err: any) {
      logger.error({ folder: FOLDER_THUMBNAILS, err }, "Thumbnail upload failed (legacy)");
      return res.status(500).json({
        success: false,
        message: friendlyUploadError(err, `legacy/${FOLDER_THUMBNAILS}`),
        detail:  err?.message,
      });
    }
  },
);

// ── Generic image upload (avatars, logos, banners, QRIS…) → yzx/images/ ──────
router.post(
  "/upload/image",
  authenticate,
  withMulterErrorHandling((req, res, cb) => imageUpload.single("image")(req, res, cb)),
  async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ success: false, message: "Tidak ada file gambar yang dipilih." });
      return;
    }
    if (!isSupabaseAvailable) {
      res.status(503).json({ success: false, message: "Storage belum dikonfigurasi. Hubungi administrator." });
      return;
    }
    try {
      const { path: storedPath, url } = await uploadToLegacyBucket(FOLDER_IMAGES, req.file);
      res.json({ success: true, url, path: storedPath, filename: storedPath, size: req.file.size, bucket: MEDIA_BUCKET });
    } catch (err: any) {
      logger.error({ folder: FOLDER_IMAGES, err }, "Image upload failed");
      res.status(500).json({ success: false, message: friendlyUploadError(err, FOLDER_IMAGES), detail: err?.message });
    }
  },
);

// ── Bundle video upload → yzx/bundles/ (legacy Supabase) ─────────────────────
router.post(
  "/upload/bundle-video",
  authenticate,
  withMulterErrorHandling((req, res, cb) => videoUpload.single("video")(req, res, cb)),
  async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ success: false, message: "Tidak ada file video bundle yang dipilih." });
      return;
    }
    if (!isSupabaseAvailable) {
      res.status(503).json({ success: false, message: "Storage belum dikonfigurasi. Hubungi administrator." });
      return;
    }
    try {
      const { path: storedPath, url } = await uploadToLegacyBucket(FOLDER_BUNDLES, req.file);
      res.json({ success: true, url, path: storedPath, filename: storedPath, size: req.file.size, bucket: MEDIA_BUCKET });
    } catch (err: any) {
      logger.error({ folder: FOLDER_BUNDLES, err }, "Bundle video upload failed");
      res.status(500).json({ success: false, message: friendlyUploadError(err, FOLDER_BUNDLES), detail: err?.message });
    }
  },
);

// ── Bundle thumbnail upload → yzx/bundle-thumbnails/ (legacy Supabase) ───────
router.post(
  "/upload/bundle-thumbnail",
  authenticate,
  withMulterErrorHandling((req, res, cb) => imageUpload.single("thumbnail")(req, res, cb)),
  async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ success: false, message: "Tidak ada file thumbnail bundle yang dipilih." });
      return;
    }
    if (!isSupabaseAvailable) {
      res.status(503).json({ success: false, message: "Storage belum dikonfigurasi. Hubungi administrator." });
      return;
    }
    try {
      const { path: storedPath, url } = await uploadToLegacyBucket(FOLDER_BUNDLE_THUMBNAILS, req.file);
      res.json({ success: true, url, path: storedPath, filename: storedPath, size: req.file.size, bucket: MEDIA_BUCKET });
    } catch (err: any) {
      logger.error({ folder: FOLDER_BUNDLE_THUMBNAILS, err }, "Bundle thumbnail upload failed");
      res.status(500).json({ success: false, message: friendlyUploadError(err, FOLDER_BUNDLE_THUMBNAILS), detail: err?.message });
    }
  },
);

// ── Payment proof → yzx/verified-creator/payments/ ───────────────────────────
//
//  Payment proofs ALWAYS go to Supabase Project 2 (Verified Creator project)
//  regardless of the uploader type. Falls back to legacy Supabase if
//  Verified Creator credentials are not set.
//
const proofUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`FORMAT_NOT_SUPPORTED: Only JPG, JPEG, PNG, and WEBP are allowed. Got: ${file.mimetype}`));
    }
  },
});

router.post(
  "/upload/payment-proof",
  authenticate,
  withMulterErrorHandling((req, res, cb) => proofUpload.single("file")(req, res, cb)),
  async (req: Request, res: Response) => {
    if (!req.user) {
      res.status(401).json({ success: false, message: "Anda harus login untuk mengupload." });
      return;
    }
    if (!req.file) {
      res.status(400).json({ success: false, message: "Tidak ada file yang dipilih." });
      return;
    }

    const userId = req.user.userId;

    // Primary: Verified Creator Supabase Project 2
    if (isVerifiedCreatorStorageAvailable) {
      try {
        const result = await uploadPaymentProof(req.file, userId);
        logger.info({ userId, path: result.path }, "Payment proof uploaded to VerifiedCreator storage");
        return res.json({
          success: true,
          url:     result.url,
          path:    result.path,
          bucket:  result.bucketName,
          folder:  result.storageFolder,
          filename: result.path,
          size:    req.file.size,
          storageProvider: result.storageProvider,
        });
      } catch (err: any) {
        logger.error({ userId, err: err?.message }, "Payment proof upload failed (VC storage)");
        return res.status(500).json({
          success: false,
          message: friendlyUploadError(err, "verified-creator/payments"),
          detail:  err?.message,
        });
      }
    }

    // Fallback: legacy Supabase (if VC credentials not configured)
    if (!isSupabaseAvailable) {
      return res.status(503).json({
        success: false,
        message:
          "Payment proof storage tidak tersedia. " +
          "Set VERIFIED_CREATOR_SUPABASE_URL dan VERIFIED_CREATOR_SUPABASE_SERVICE_ROLE_KEY.",
      });
    }

    logger.warn({ userId }, "Payment proof falling back to legacy Supabase (VC credentials not set)");
    const proofFolder = "verified-creator/payments";
    const ext = extOf(req.file.originalname) || ".jpg";
    const storagePath = `${proofFolder}/${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;

    try {
      const { path: savedPath, url: publicUrl } = await uploadWithRetry(
        MEDIA_BUCKET, storagePath, req.file.buffer, req.file.mimetype, { upsert: false, maxRetries: 3 },
      );
      logger.info({ userId, path: savedPath }, "Payment proof uploaded (legacy fallback)");
      return res.json({
        success: true,
        url:     publicUrl,
        path:    savedPath,
        bucket:  MEDIA_BUCKET,
        folder:  proofFolder,
        filename: storagePath,
        size:    req.file.size,
        storageProvider: "legacy",
      });
    } catch (err: any) {
      logger.error({ userId, storagePath, err: err?.message }, "Payment proof upload failed (legacy)");
      return res.status(500).json({
        success: false,
        message: friendlyUploadError(err, `legacy/${proofFolder}`),
        detail:  err?.message,
      });
    }
  },
);

// ── Debug endpoint: all storage provider statuses ─────────────────────────────
router.get("/upload/debug", authenticate, async (req: Request, res: Response) => {
  const result: Record<string, any> = {
    timestamp: new Date().toISOString(),
    architecture: "PUBLIC + OWNER (2 Supabase projects)",
    storageProviders: {
      publicSupabase: {
        description:      "Creator + Verified Creator uploads",
        supabaseUrl:      process.env.PUBLIC_SUPABASE_URL ?? "(not set)",
        serviceKeyPresent: !!process.env.PUBLIC_SUPABASE_SERVICE_KEY,
        available:        isCreatorStorageAvailable,
        bucket:           "yzx",
        creatorVideoFolder:      "public/creator/videos",
        creatorThumbFolder:      "public/creator/thumbnails",
        vcVideoFolder:           "public/verified-creator/videos",
        vcThumbFolder:           "public/verified-creator/thumbnails",
        vcPaymentsFolder:        "public/verified-creator/payments",
      },
      ownerSupabase: {
        description:      "Owner / Admin uploads",
        supabaseUrl:      process.env.OWNER_SUPABASE_URL ?? "(not set)",
        serviceKeyPresent: !!process.env.OWNER_SUPABASE_SERVICE_KEY,
        available:        isOwnerStorageAvailable,
        bucket:           "yzx",
        videoFolder:      "owner/videos",
        thumbFolder:      "owner/thumbnails",
      },
      legacy: {
        description:      "Pre-migration uploads (backward-compat)",
        supabaseUrl:      process.env.SUPABASE_URL ?? "(not set)",
        serviceKeyPresent: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        available:        isSupabaseAvailable,
        bucket:           MEDIA_BUCKET,
      },
    },
  };

  // Test legacy Supabase connectivity
  if (isSupabaseAvailable) {
    try {
      const { data: buckets, error } = await supabase.storage.listBuckets();
      result.storageProviders.legacy.buckets = error
        ? { error: error.message }
        : (buckets ?? []).map((b: any) => ({ name: b.name, public: b.public }));
    } catch (e: any) {
      result.storageProviders.legacy.connectError = e?.message;
    }
  }

  res.json(result);
});

export default router;
