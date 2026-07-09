import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import path from "path";
import { authenticate } from "../middlewares/auth";
import { supabase, PAYMENT_BUCKET, MEDIA_BUCKET, getPublicUrl } from "../lib/supabase";
import { logger } from "../lib/logger";

const router = Router();

// ── Limits & allowed formats ─────────────────────────────────────────────────
const MAX_VIDEO_SIZE = 500 * 1024 * 1024; // 500 MB
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB

const ALLOWED_VIDEO_MIMES = ["video/mp4", "video/webm", "video/quicktime"];
const ALLOWED_VIDEO_EXT = [".mp4", ".webm", ".mov"];
const ALLOWED_IMAGE_MIMES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const ALLOWED_IMAGE_EXT = [".jpg", ".jpeg", ".png", ".webp"];

function extOf(filename: string): string {
  return path.extname(filename).toLowerCase();
}

// All uploads use memory storage — nothing ever touches local disk.
// Buffers are streamed straight to Supabase Storage.
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
 * Wraps a multer middleware so every failure (unexpected field, file too
 * large, unsupported format, etc.) becomes a clean JSON response instead of
 * Express's default HTML error page / an uncaught MulterError.
 */
function withMulterErrorHandling(middleware: (req: Request, res: Response, cb: (err: any) => void) => void) {
  return (req: Request, res: Response, next: NextFunction) => {
    middleware(req, res, (err: any) => {
      if (!err) {
        next();
        return;
      }

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
  const { data, error } = await supabase.storage.from(MEDIA_BUCKET).upload(filename, file.buffer, {
    contentType: file.mimetype,
    upsert: false,
  });
  if (error) throw error;
  return { path: data.path, url: getPublicUrl(MEDIA_BUCKET, data.path) };
}

// ── Video upload → Supabase Storage (yzx/videos) ─────────────────────────────
router.post(
  "/upload/video",
  authenticate,
  withMulterErrorHandling((req, res, cb) => videoUpload.single("video")(req, res, cb)),
  async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ success: false, message: "Tidak ada file video yang dipilih." });
      return;
    }
    try {
      const { path: storedPath, url } = await uploadToMediaBucket("videos", req.file);
      logger.info({ path: storedPath, size: req.file.size }, "Video uploaded to Supabase");
      res.json({ success: true, url, path: storedPath, filename: storedPath, size: req.file.size });
    } catch (err: any) {
      logger.error({ err }, "Video upload to Supabase failed");
      res.status(500).json({ success: false, message: "Upload video gagal." });
    }
  },
);

// ── Thumbnail upload → Supabase Storage (yzx/thumnails) ──────────────────────
router.post(
  "/upload/thumbnail",
  authenticate,
  withMulterErrorHandling((req, res, cb) => imageUpload.single("thumbnail")(req, res, cb)),
  async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ success: false, message: "Tidak ada file thumbnail yang dipilih." });
      return;
    }
    try {
      const { path: storedPath, url } = await uploadToMediaBucket("thumnails", req.file);
      logger.info({ path: storedPath, size: req.file.size }, "Thumbnail uploaded to Supabase");
      res.json({ success: true, url, path: storedPath, filename: storedPath, size: req.file.size });
    } catch (err: any) {
      logger.error({ err }, "Thumbnail upload to Supabase failed");
      res.status(500).json({ success: false, message: "Upload thumbnail gagal." });
    }
  },
);

// ── Generic image upload (avatars, logos, banners, QRIS...) ─────────────────
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
      const { path: storedPath, url } = await uploadToMediaBucket("images", req.file);
      logger.info({ path: storedPath, size: req.file.size }, "Image uploaded to Supabase");
      res.json({ success: true, url, path: storedPath, filename: storedPath, size: req.file.size });
    } catch (err: any) {
      logger.error({ err }, "Image upload to Supabase failed");
      res.status(500).json({ success: false, message: "Upload gambar gagal." });
    }
  },
);

// ── Payment proof → Supabase Storage (separate "payments" bucket) ───────────
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
    const filename = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;

    logger.info({ userId, filename, size: req.file.size, mimetype: req.file.mimetype }, "Uploading payment proof to Supabase");

    try {
      const { data, error } = await supabase.storage
        .from(PAYMENT_BUCKET)
        .upload(filename, req.file.buffer, { contentType: req.file.mimetype, upsert: false });

      if (error) {
        logger.error({ supabaseError: error, userId, filename }, "Supabase upload error");

        let userMessage = "Upload gagal.";
        const msg = error.message?.toLowerCase() ?? "";
        if (msg.includes("bucket") && msg.includes("not found")) {
          userMessage = `Bucket "${PAYMENT_BUCKET}" tidak ditemukan di Supabase. Buat bucket tersebut di dashboard Supabase Storage terlebih dahulu.`;
        } else if (msg.includes("permission") || msg.includes("policy") || msg.includes("violates")) {
          userMessage = "Akses ditolak oleh Supabase. Periksa policy RLS pada bucket.";
        } else if (msg.includes("already exists") || msg.includes("duplicate")) {
          userMessage = "File dengan nama yang sama sudah ada. Silakan coba lagi.";
        } else if (msg.includes("size") || msg.includes("too large")) {
          userMessage = "File terlalu besar menurut konfigurasi Supabase.";
        }

        res.status(500).json({ success: false, message: userMessage });
        return;
      }

      const publicUrl = getPublicUrl(PAYMENT_BUCKET, data.path);
      logger.info({ userId, path: data.path, publicUrl }, "Payment proof uploaded successfully");

      res.json({ success: true, url: publicUrl, path: data.path, bucket: PAYMENT_BUCKET, filename, size: req.file.size });
    } catch (err: any) {
      logger.error({ err, userId }, "Unexpected error during Supabase upload");
      res.status(502).json({ success: false, message: "Gagal menghubungi Supabase Storage. Periksa koneksi server." });
    }
  },
);

// ── Debug endpoint: Supabase connection & bucket status ───────────────────────
router.get("/upload/debug", authenticate, async (req: Request, res: Response) => {
  const result: Record<string, any> = {
    supabaseUrl: process.env.SUPABASE_URL ?? "(not set)",
    serviceKeyPresent: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    bucket: PAYMENT_BUCKET,
    mediaBucket: MEDIA_BUCKET,
    bucketStatus: null,
    bucketPublic: null,
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
      const bucket = (buckets ?? []).find((b: any) => b.name === PAYMENT_BUCKET);
      result.bucketStatus = bucket ? "found" : "NOT_FOUND";
      result.bucketPublic = bucket?.public ?? null;

      const mediaBucket = (buckets ?? []).find((b: any) => b.name === MEDIA_BUCKET);
      result.mediaBucketStatus = mediaBucket ? "found" : "NOT_FOUND";
      result.mediaBucketPublic = mediaBucket?.public ?? null;
    }
  } catch (e: any) {
    result.listError = { message: e?.message ?? String(e) };
  }

  const tinyPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  const testPath = `debug/${req.user!.userId}-${Date.now()}.png`;
  try {
    const { data, error } = await supabase.storage
      .from(PAYMENT_BUCKET)
      .upload(testPath, tinyPng, { contentType: "image/png", upsert: true });

    if (error) {
      result.uploadTestResult = "FAILED";
      result.uploadTestError = { message: error.message, statusCode: (error as any).statusCode ?? null };
    } else {
      result.uploadTestResult = "SUCCESS";
      result.uploadTestUrl = getPublicUrl(PAYMENT_BUCKET, data.path);
      await supabase.storage.from(PAYMENT_BUCKET).remove([testPath]);
    }
  } catch (e: any) {
    result.uploadTestResult = "EXCEPTION";
    result.uploadTestError = { message: e?.message ?? String(e) };
  }

  res.json(result);
});

export default router;
