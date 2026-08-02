import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import path from "path";
import { authenticate } from "../middlewares/auth";
import {
  supabase, MEDIA_BUCKET,
  FOLDER_VIDEOS, FOLDER_THUMBNAILS, FOLDER_IMAGES, FOLDER_PAYMENTS,
  FOLDER_BUNDLES, FOLDER_BUNDLE_THUMBNAILS,
  FOLDER_BY_UPLOADER_TYPE, FOLDER_VERIFIED_CREATOR_PAYMENTS,
  UPLOADER_TYPES, type UploaderType,
  getPublicUrl, uploadWithRetry,
} from "../lib/supabase";
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

/** Streams a multer memory-storage file buffer into the media bucket under `folder/`. */
async function uploadToMediaBucket(folder: string, file: Express.Multer.File) {
  const ext = extOf(file.originalname);
  const filename = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
  logger.info({ bucket: MEDIA_BUCKET, folder, filename, size: file.size }, "UPLOAD START");
  try {
    const result = await uploadWithRetry(MEDIA_BUCKET, filename, file.buffer, file.mimetype, { upsert: false });
    logger.info({ bucket: MEDIA_BUCKET, folder, path: result.path }, "UPLOAD SUCCESS");
    return result;
  } catch (err: any) {
    logger.error({ bucket: MEDIA_BUCKET, folder, filename, err: err?.message }, "UPLOAD ERROR");
    throw err;
  }
}

/**
 * Resolve the Supabase sub-folder for a video/thumbnail upload based on
 * the uploader type.  Falls back to the legacy flat folder when no
 * uploader type is supplied (backward-compatible).
 */
function resolveVideoFolder(uploaderType: string | undefined, kind: "videos" | "thumbnails"): {
  folder: string;
  uploaderType: UploaderType | null;
} {
  if (!uploaderType) {
    return { folder: kind === "videos" ? FOLDER_VIDEOS : FOLDER_THUMBNAILS, uploaderType: null };
  }

  // Normalize: accept "Verified Creator" → "verified_creator", "Creator" → "creator", "Owner" → "owner"
  const normalized = uploaderType.trim().toLowerCase().replace(/\s+/g, "_") as UploaderType;
  if (!UPLOADER_TYPES.includes(normalized)) {
    throw new Error(
      `INVALID_UPLOADER_TYPE: Uploader type "${uploaderType}" tidak valid. ` +
      `Gunakan salah satu: Creator, Verified Creator, Owner.`,
    );
  }
  return { folder: FOLDER_BY_UPLOADER_TYPE[normalized][kind], uploaderType: normalized };
}

/** Build a user-friendly error message from a Supabase storage error. */
function friendlyUploadError(err: any, bucket: string, folder: string): string {
  const msg = (err?.message ?? "").toLowerCase();
  if (msg.includes("bucket") && msg.includes("not found")) {
    return `Bucket tidak ditemukan: "${bucket}/${folder}". Pastikan bucket "${bucket}" sudah dibuat di Supabase Storage.`;
  }
  if (msg.includes("permission") || msg.includes("policy") || msg.includes("violates") || msg.includes("denied")) {
    return `Akses ditolak oleh Supabase Storage (${bucket}/${folder}). Periksa RLS policy bucket.`;
  }
  if (msg.includes("already exists") || msg.includes("duplicate")) {
    return "File dengan nama yang sama sudah ada. Silakan coba lagi.";
  }
  if (msg.includes("too large") || msg.includes("size")) {
    return "File terlalu besar menurut konfigurasi Supabase Storage.";
  }
  if (msg.includes("network") || msg.includes("fetch") || msg.includes("timeout")) {
    return "Gagal menghubungi Supabase Storage. Periksa koneksi server.";
  }
  if (msg.includes("not configured") || msg.includes("belum diset")) {
    return "Storage belum dikonfigurasi. Hubungi administrator.";
  }
  return `Upload gagal (${bucket}/${folder}): ${err?.message ?? "Unknown error"}`;
}

// ── Video upload → role-based folder (or legacy yzx/videos/) ─────────────────
//
//  Accepts optional field `uploaderType` in the request body:
//    "Creator"          → yzx/creator/videos/
//    "Verified Creator" → yzx/verified-creator/videos/
//    "Owner"            → yzx/owner/videos/
//    (omitted)          → yzx/videos/  (legacy, backward-compatible)
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

    let resolved: ReturnType<typeof resolveVideoFolder>;
    try {
      resolved = resolveVideoFolder(req.body?.uploaderType, "videos");
    } catch (err: any) {
      if (err.message.startsWith("INVALID_UPLOADER_TYPE")) {
        res.status(400).json({ success: false, message: err.message.replace("INVALID_UPLOADER_TYPE: ", "") });
        return;
      }
      throw err;
    }

    const { folder, uploaderType } = resolved;
    try {
      const { path: storedPath, url } = await uploadToMediaBucket(folder, req.file);
      res.json({
        success: true,
        url,
        path: storedPath,
        filename: storedPath,
        size: req.file.size,
        bucket: MEDIA_BUCKET,
        storageFolder: folder,
        uploaderType: uploaderType ?? null,
      });
    } catch (err: any) {
      logger.error({ bucket: MEDIA_BUCKET, folder, err }, "Video upload failed");
      res.status(500).json({ success: false, message: friendlyUploadError(err, MEDIA_BUCKET, folder), detail: err?.message });
    }
  },
);

// ── Thumbnail upload → role-based folder (or legacy yzx/thumnails/) ──────────
//
//  Accepts optional field `uploaderType` in the request body:
//    "Creator"          → yzx/creator/thumbnails/
//    "Verified Creator" → yzx/verified-creator/thumbnails/
//    "Owner"            → yzx/owner/thumbnails/
//    (omitted)          → yzx/thumnails/  (legacy, backward-compatible)
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

    let resolved: ReturnType<typeof resolveVideoFolder>;
    try {
      resolved = resolveVideoFolder(req.body?.uploaderType, "thumbnails");
    } catch (err: any) {
      if (err.message.startsWith("INVALID_UPLOADER_TYPE")) {
        res.status(400).json({ success: false, message: err.message.replace("INVALID_UPLOADER_TYPE: ", "") });
        return;
      }
      throw err;
    }

    const { folder, uploaderType } = resolved;
    try {
      const { path: storedPath, url } = await uploadToMediaBucket(folder, req.file);
      res.json({
        success: true,
        url,
        path: storedPath,
        filename: storedPath,
        size: req.file.size,
        bucket: MEDIA_BUCKET,
        storageFolder: folder,
        uploaderType: uploaderType ?? null,
      });
    } catch (err: any) {
      logger.error({ bucket: MEDIA_BUCKET, folder, err }, "Thumbnail upload failed");
      res.status(500).json({ success: false, message: friendlyUploadError(err, MEDIA_BUCKET, folder), detail: err?.message });
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
    try {
      const { path: storedPath, url } = await uploadToMediaBucket(FOLDER_IMAGES, req.file);
      res.json({ success: true, url, path: storedPath, filename: storedPath, size: req.file.size, bucket: MEDIA_BUCKET });
    } catch (err: any) {
      logger.error({ bucket: MEDIA_BUCKET, folder: FOLDER_IMAGES, err }, "Image upload failed");
      res.status(500).json({ success: false, message: friendlyUploadError(err, MEDIA_BUCKET, FOLDER_IMAGES), detail: err?.message });
    }
  },
);

// ── Bundle video upload → yzx/bundles/ ───────────────────────────────────────
router.post(
  "/upload/bundle-video",
  authenticate,
  withMulterErrorHandling((req, res, cb) => videoUpload.single("video")(req, res, cb)),
  async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ success: false, message: "Tidak ada file video bundle yang dipilih." });
      return;
    }
    try {
      const { path: storedPath, url } = await uploadToMediaBucket(FOLDER_BUNDLES, req.file);
      res.json({ success: true, url, path: storedPath, filename: storedPath, size: req.file.size, bucket: MEDIA_BUCKET });
    } catch (err: any) {
      logger.error({ bucket: MEDIA_BUCKET, folder: FOLDER_BUNDLES, err }, "Bundle video upload failed");
      res.status(500).json({ success: false, message: friendlyUploadError(err, MEDIA_BUCKET, FOLDER_BUNDLES), detail: err?.message });
    }
  },
);

// ── Bundle thumbnail upload → yzx/bundle-thumbnails/ ─────────────────────────
router.post(
  "/upload/bundle-thumbnail",
  authenticate,
  withMulterErrorHandling((req, res, cb) => imageUpload.single("thumbnail")(req, res, cb)),
  async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ success: false, message: "Tidak ada file thumbnail bundle yang dipilih." });
      return;
    }
    try {
      const { path: storedPath, url } = await uploadToMediaBucket(FOLDER_BUNDLE_THUMBNAILS, req.file);
      res.json({ success: true, url, path: storedPath, filename: storedPath, size: req.file.size, bucket: MEDIA_BUCKET });
    } catch (err: any) {
      logger.error({ bucket: MEDIA_BUCKET, folder: FOLDER_BUNDLE_THUMBNAILS, err }, "Bundle thumbnail upload failed");
      res.status(500).json({ success: false, message: friendlyUploadError(err, MEDIA_BUCKET, FOLDER_BUNDLE_THUMBNAILS), detail: err?.message });
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
    const ext = extOf(req.file.originalname) || ".jpg";
    // Payment proofs always land in yzx/verified-creator/payments/ regardless of uploader type
    const proofFolder = FOLDER_VERIFIED_CREATOR_PAYMENTS;
    const storagePath = `${proofFolder}/${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;

    logger.info({ userId, bucket: MEDIA_BUCKET, storagePath, size: req.file.size }, "UPLOAD START payment-proof");

    try {
      const { path: savedPath, url: publicUrl } = await uploadWithRetry(
        MEDIA_BUCKET,
        storagePath,
        req.file.buffer,
        req.file.mimetype,
        { upsert: false, maxRetries: 3 },
      );

      logger.info({ userId, path: savedPath }, "Payment proof uploaded successfully");
      res.json({
        success: true,
        url: publicUrl,
        path: savedPath,
        bucket: MEDIA_BUCKET,
        folder: proofFolder,
        filename: storagePath,
        size: req.file.size,
      });
    } catch (err: any) {
      logger.error({ bucket: MEDIA_BUCKET, folder: proofFolder, userId, storagePath, err: err?.message }, "UPLOAD ERROR payment-proof");
      res.status(500).json({ success: false, message: friendlyUploadError(err, MEDIA_BUCKET, proofFolder), detail: err?.message });
    }
  },
);

// ── Debug endpoint: Supabase connection & bucket status ───────────────────────
router.get("/upload/debug", authenticate, async (req: Request, res: Response) => {
  const EXPECTED_FOLDERS = [
    // Legacy folders (existing files live here)
    FOLDER_VIDEOS, FOLDER_THUMBNAILS, FOLDER_IMAGES,
    FOLDER_PAYMENTS, FOLDER_BUNDLES, FOLDER_BUNDLE_THUMBNAILS,
    // Multi-storage role-based folders
    "creator/videos", "creator/thumbnails",
    "verified-creator/videos", "verified-creator/thumbnails", FOLDER_VERIFIED_CREATOR_PAYMENTS,
    "owner/videos", "owner/thumbnails",
  ];

  const result: Record<string, any> = {
    supabaseUrl: process.env.SUPABASE_URL ?? "(not set)",
    serviceKeyPresent: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    mediaBucket: MEDIA_BUCKET,
    expectedFolders: EXPECTED_FOLDERS,
    buckets: [],
    mediaBucketStatus: null,
    mediaBucketPublic: null,
    listError: null,
    uploadTestResult: null,
    uploadTestError: null,
    timestamp: new Date().toISOString(),
  };

  try {
    const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
    if (listErr) {
      result.listError = { message: listErr.message, statusCode: (listErr as any).statusCode };
    } else {
      result.buckets = (buckets ?? []).map((b: any) => ({ name: b.name, public: b.public }));
      const mediaBucket = (buckets ?? []).find((b: any) => b.name === MEDIA_BUCKET);
      result.mediaBucketStatus = mediaBucket ? "found" : "NOT_FOUND";
      result.mediaBucketPublic = mediaBucket?.public ?? null;
    }
  } catch (e: any) {
    result.listError = { message: e?.message ?? String(e) };
  }

  // Test upload to yzx/payments/debug/
  const tinyPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  const testPath = `${FOLDER_PAYMENTS}/debug/${req.user!.userId}-${Date.now()}.png`;
  try {
    const { path: savedPath, url } = await uploadWithRetry(MEDIA_BUCKET, testPath, tinyPng, "image/png", { upsert: true });
    result.uploadTestResult = "SUCCESS";
    result.uploadTestUrl = url;
    await supabase.storage.from(MEDIA_BUCKET).remove([savedPath]);
  } catch (e: any) {
    result.uploadTestResult = "FAILED";
    result.uploadTestError = { message: e?.message ?? String(e) };
  }

  res.json(result);
});

export default router;
