import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import path from "path";
import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import { usersTable, customRolesTable, userCustomRolesTable } from "@workspace/db";
import { authenticate, requireRole } from "../middlewares/auth";
import {
  supabase, MEDIA_BUCKET,
  FOLDER_VIDEOS, FOLDER_THUMBNAILS,
  uploadWithRetry,
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
  isPublicStorageAvailable,
  uploadToPublicBucket,
  isMediaStorageAvailable,
  uploadToMediaStorage,
  uploadBundleThumbnailToMedia,
} from "../lib/storage";
import type { UploadVideoResult, UploadThumbnailResult, NormalizedUploaderType } from "../lib/storage";
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
    return `Bucket 'yzx' tidak ditemukan. Silakan buat bucket yzx di Supabase Storage.`;
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
    return err.message; // Already user-friendly
  }
  if (msg.includes("gagal") || msg.includes("failed")) {
    return err.message.length < 300 ? err.message : `Upload gagal (${context}): error tidak terduga.`;
  }
  return `Upload gagal (${context}): ${err?.message ?? "Unknown error"}`;
}

/** Streams a multer memory-storage file buffer into the media bucket under `folder/`. */
async function uploadToLegacyBucket(folder: string, file: Express.Multer.File) {
  const ext = extOf(file.originalname);
  const filename = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
  logger.info({ bucket: MEDIA_BUCKET, folder, filename, size: file.size }, "UPLOAD START (direct)");
  try {
    const result = await uploadWithRetry(MEDIA_BUCKET, filename, file.buffer, file.mimetype, { upsert: false });
    logger.info({ bucket: MEDIA_BUCKET, folder, path: result.path }, "UPLOAD SUCCESS (direct)");
    return result;
  } catch (err: any) {
    logger.error({ bucket: MEDIA_BUCKET, folder, filename, err: err?.message }, "UPLOAD ERROR (direct)");
    throw err;
  }
}

/**
 * Resolve the authoritative NormalizedUploaderType for an authenticated user.
 */
async function resolveUploaderType(
  userId: string,
  userRole: string,
  clientUploaderType: string | undefined,
): Promise<{ type: NormalizedUploaderType | null } | { error: string; status: number }> {
  const isAdminOrOwner = ["admin", "owner"].includes(userRole);

  if (isAdminOrOwner && clientUploaderType) {
    const normalized = normalizeUploaderType(clientUploaderType);
    return { type: normalized };
  }

  if (["user", "meril"].includes(userRole)) {
    return { type: "creator" };
  }

  try {
    const rows = await db
      .select({ permUploadVideo: customRolesTable.permUploadVideo })
      .from(userCustomRolesTable)
      .innerJoin(customRolesTable, eq(userCustomRolesTable.roleId, customRolesTable.id))
      .where(and(
        eq(userCustomRolesTable.userId, userId),
        eq(customRolesTable.isActive, true),
      ));

    const hasUploadPermission = rows.some((r) => r.permUploadVideo === true);

    if (hasUploadPermission) {
      return { type: "creator" };
    }
  } catch (err) {
    logger.error({ userId, err }, "resolveUploaderType: DB custom-role lookup failed");
    return { error: "Gagal memeriksa izin upload.", status: 500 };
  }

  if (isAdminOrOwner) {
    return {
      error: "Admin/Owner harus menggunakan halaman Upload Admin.",
      status: 403,
    };
  }

  return {
    error: "Kamu tidak memiliki Role yang memiliki izin untuk mengupload. Hubungi admin untuk mendapatkan akses.",
    status: 403,
  };
}

// ── Video upload ──────────────────────────────────────────────────────────────
router.post(
  "/upload/video",
  authenticate,
  withMulterErrorHandling((req, res, cb) => videoUpload.single("video")(req, res, cb)),
  async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ success: false, message: "Tidak ada file video yang dipilih." });
      return;
    }

    const userRole = req.user?.role ?? "";

    const resolved = await resolveUploaderType(
      req.user!.userId,
      userRole,
      req.body?.uploaderType as string | undefined,
    );

    if ("error" in resolved) {
      return res.status(resolved.status).json({ success: false, message: resolved.error });
    }

    const normalized = resolved.type;

    if (normalized) {
      const storage = getStorageService(normalized);
      const title   = req.body?.title ?? req.file.originalname ?? "Upload";
      try {
        const result: UploadVideoResult = await storage.uploadVideo(req.file, { title, userId: req.user!.userId });
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
          bunnyVideoId:      null,
          bunnyPlaybackUrl:  null,
          bunnyLibraryId:    null,
          videoSourceType:   "upload",
        });
      } catch (err: any) {
        logger.error({ uploaderType: normalized, err }, "Video upload failed");
        return res.status(500).json({
          success: false,
          message: friendlyUploadError(err, `${normalized} storage`),
          detail:  err?.message,
        });
      }
    }

    if (!isSupabaseAvailable) {
      return res.status(503).json({
        success: false,
        message: "Storage belum dikonfigurasi (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum diset). Hubungi administrator.",
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
        storageProvider: "unified_supabase",
        bucket: MEDIA_BUCKET,
        storageFolder: FOLDER_VIDEOS,
        uploaderType: null,
        bunnyVideoId: null,
        bunnyPlaybackUrl: null,
        bunnyLibraryId: null,
      });
    } catch (err: any) {
      logger.error({ folder: FOLDER_VIDEOS, err }, "Video upload failed (direct)");
      return res.status(500).json({
        success: false,
        message: friendlyUploadError(err, `${FOLDER_VIDEOS}`),
        detail:  err?.message,
      });
    }
  },
);

// ── Thumbnail upload ──────────────────────────────────────────────────────────
router.post(
  "/upload/thumbnail",
  authenticate,
  withMulterErrorHandling((req, res, cb) => imageUpload.single("thumbnail")(req, res, cb)),
  async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ success: false, message: "Tidak ada file thumbnail yang dipilih." });
      return;
    }

    const userRole = req.user?.role ?? "";

    const resolved = await resolveUploaderType(
      req.user!.userId,
      userRole,
      req.body?.uploaderType as string | undefined,
    );

    if ("error" in resolved) {
      return res.status(resolved.status).json({ success: false, message: resolved.error });
    }

    const normalized = resolved.type;

    if (normalized) {
      const storage = getStorageService(normalized);
      try {
        const result: UploadThumbnailResult = await storage.uploadThumbnail(req.file, { userId: req.user!.userId });
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
        logger.error({ uploaderType: normalized, err }, "Thumbnail upload failed");
        return res.status(500).json({
          success: false,
          message: friendlyUploadError(err, `${normalized} thumbnail`),
          detail:  err?.message,
        });
      }
    }

    if (!isSupabaseAvailable) {
      return res.status(503).json({
        success: false,
        message: "Storage belum dikonfigurasi (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum diset). Hubungi administrator.",
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
        storageProvider: "unified_supabase",
        bucket: MEDIA_BUCKET,
        storageFolder: FOLDER_THUMBNAILS,
        uploaderType: null,
      });
    } catch (err: any) {
      logger.error({ folder: FOLDER_THUMBNAILS, err }, "Thumbnail upload failed (direct)");
      return res.status(500).json({
        success: false,
        message: friendlyUploadError(err, `${FOLDER_THUMBNAILS}`),
        detail:  err?.message,
      });
    }
  },
);

// ── Generic image upload (avatars, QRIS, banners, logos…) ────────────────────
router.post(
  "/upload/image",
  authenticate,
  withMulterErrorHandling((req, res, cb) => imageUpload.single("image")(req, res, cb)),
  async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ success: false, message: "Tidak ada file gambar yang dipilih." });
      return;
    }
    if (!isMediaStorageAvailable) {
      res.status(503).json({ success: false, message: "Media storage belum dikonfigurasi (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY). Hubungi administrator." });
      return;
    }
    const assetType = req.body?.assetType as string | undefined;
    try {
      const { path: storedPath, url, folder } = await uploadToMediaStorage(assetType, req.file);
      res.json({ success: true, url, path: storedPath, filename: storedPath, size: req.file.size, bucket: "yzx", folder, assetType: assetType ?? "images" });
    } catch (err: any) {
      logger.error({ assetType, err }, "Image upload failed");
      res.status(500).json({ success: false, message: friendlyUploadError(err, `media/${assetType ?? "images"}`), detail: err?.message });
    }
  },
);

// ── Bundle video upload ──────────────────────────────────────────────────────
router.post(
  "/upload/bundle-video",
  authenticate,
  withMulterErrorHandling((req, res, cb) => videoUpload.single("video")(req, res, cb)),
  async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ success: false, message: "Tidak ada file video bundle yang dipilih." });
      return;
    }
    if (!isPublicStorageAvailable) {
      res.status(503).json({ success: false, message: "Storage belum dikonfigurasi (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY). Hubungi administrator." });
      return;
    }
    try {
      const { path: storedPath, url } = await uploadToPublicBucket("public/bundles", req.file);
      res.json({ success: true, url, path: storedPath, filename: storedPath, size: req.file.size, bucket: "yzx" });
    } catch (err: any) {
      logger.error({ folder: "public/bundles", err }, "Bundle video upload failed");
      res.status(500).json({ success: false, message: friendlyUploadError(err, "public/bundles"), detail: err?.message });
    }
  },
);

// ── Bundle thumbnail upload ──────────────────────────────────────────────────
router.post(
  "/upload/bundle-thumbnail",
  authenticate,
  withMulterErrorHandling((req, res, cb) => imageUpload.single("thumbnail")(req, res, cb)),
  async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ success: false, message: "Tidak ada file thumbnail bundle yang dipilih." });
      return;
    }
    if (!isMediaStorageAvailable) {
      res.status(503).json({ success: false, message: "Media storage belum dikonfigurasi (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY). Hubungi administrator." });
      return;
    }
    try {
      const { path: storedPath, url, folder } = await uploadBundleThumbnailToMedia(req.file);
      res.json({ success: true, url, path: storedPath, filename: storedPath, size: req.file.size, bucket: "yzx", folder });
    } catch (err: any) {
      logger.error({ folder: "media/bundle-thumbnails", err }, "Bundle thumbnail upload failed");
      res.status(500).json({ success: false, message: friendlyUploadError(err, "media/bundle-thumbnails"), detail: err?.message });
    }
  },
);

// ── Payment proof → yzx/verified-creator/payments/ ───────────────────────────
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

    if (!isSupabaseAvailable) {
      return res.status(503).json({
        success: false,
        message: "Payment proof storage tidak tersedia (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum diset).",
      });
    }

    try {
      const result = await uploadPaymentProof(req.file, userId);
      logger.info({ userId, path: result.path }, "Payment proof uploaded to storage");
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
      logger.error({ userId, err: err?.message }, "Payment proof upload failed");
      return res.status(500).json({
        success: false,
        message: friendlyUploadError(err, "verified-creator/payments"),
        detail:  err?.message,
      });
    }
  },
);

// ── Home Feed video upload ───────────────────────────────────────────────────
router.post(
  "/upload/home-feed-video",
  authenticate,
  requireRole("admin", "owner"),
  withMulterErrorHandling((req, res, cb) => videoUpload.single("video")(req, res, cb)),
  async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ success: false, message: "Tidak ada file video yang dipilih." });
      return;
    }
    if (!isMediaStorageAvailable) {
      res.status(503).json({ success: false, message: "Media storage belum dikonfigurasi (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY). Hubungi administrator." });
      return;
    }
    try {
      const { path: storedPath, url, folder } = await uploadToMediaStorage("home-feed-video", req.file);
      res.json({ success: true, url, path: storedPath, filename: storedPath, size: req.file.size, bucket: "yzx", folder });
    } catch (err: any) {
      logger.error({ err }, "Home feed video upload failed");
      res.status(500).json({ success: false, message: friendlyUploadError(err, "media/home-feed/videos"), detail: err?.message });
    }
  },
);

// ── Home Feed thumbnail upload ───────────────────────────────────────────────
router.post(
  "/upload/home-feed-thumbnail",
  authenticate,
  requireRole("admin", "owner"),
  withMulterErrorHandling((req, res, cb) => imageUpload.single("thumbnail")(req, res, cb)),
  async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ success: false, message: "Tidak ada file thumbnail yang dipilih." });
      return;
    }
    if (!isMediaStorageAvailable) {
      res.status(503).json({ success: false, message: "Media storage belum dikonfigurasi (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY). Hubungi administrator." });
      return;
    }
    try {
      const { path: storedPath, url, folder } = await uploadToMediaStorage("home-feed-thumbnail", req.file);
      res.json({ success: true, url, path: storedPath, filename: storedPath, size: req.file.size, bucket: "yzx", folder });
    } catch (err: any) {
      logger.error({ err }, "Home feed thumbnail upload failed");
      res.status(500).json({ success: false, message: friendlyUploadError(err, "media/home-feed/thumbnails"), detail: err?.message });
    }
  },
);

// ── Debug endpoint: unified storage status ────────────────────────────────────
router.get("/upload/debug", authenticate, async (req: Request, res: Response) => {
  const { getJwtRole, UNIFIED_SUPABASE_URL, UNIFIED_SUPABASE_KEY } = await import("../lib/storage/supabase-helpers");

  const supabaseUrl = process.env.SUPABASE_URL || UNIFIED_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || UNIFIED_SUPABASE_KEY;
  const keyRole = serviceKey ? getJwtRole(serviceKey) : "none";

  let storageProbe: Record<string, any> = { status: "not_configured" };
  if (isSupabaseAvailable) {
    try {
      const { data: buckets, error } = await supabase.storage.listBuckets();
      if (error) {
        storageProbe = { status: "error", keyRole, error: error.message };
      } else {
        const found = (buckets ?? []).find((b: any) => b.name === "yzx");
        storageProbe = {
          status: "ok",
          keyRole,
          bucket: "yzx",
          bucketExists: !!found,
          bucketPublic: found?.public ?? null,
          allBuckets: (buckets ?? []).map((b: any) => ({ name: b.name, public: b.public })),
          warning: keyRole !== "service_role"
            ? `Key role is "${keyRole}" — only service_role bypasses RLS. Uploads will fail!`
            : undefined,
        };
      }
    } catch (e: any) {
      storageProbe = { status: "connect_error", keyRole, error: e?.message };
    }
  }

  res.json({
    timestamp: new Date().toISOString(),
    architecture: "Unified Single Supabase Project",
    note: "All uploads use service_role keys server-side — RLS is bypassed. " +
          "If keyRole shows 'anon', replace the secret with the service_role key.",
    supabase: {
      url: supabaseUrl || "(not set)",
      available: isSupabaseAvailable,
      bucket: "yzx",
      keyRole,
      probe: storageProbe,
      folders: {
        creatorVideos: "videos/{userId}",
        creatorThumbs: "thumbnails/{userId}",
        ownerVideos: "owner/videos",
        ownerThumbs: "owner/thumbnails",
        payments: "verified-creator/payments/{userId}",
        media: "media/*",
      },
    },
    // Backward-compat keys for any existing clients expecting individual provider objects
    storageProviders: {
      supabase: {
        description: "Unified Supabase Storage",
        url: supabaseUrl || "(not set)",
        available: isSupabaseAvailable,
        probe: storageProbe,
      },
    },
  });
});

export default router;
