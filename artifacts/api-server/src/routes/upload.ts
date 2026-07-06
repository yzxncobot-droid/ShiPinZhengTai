import { Router, Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { authenticate } from "../middlewares/auth";
import { supabase, PAYMENT_BUCKET, getPublicUrl } from "../lib/supabase";
import { logger } from "../lib/logger";

const router = Router();

// ── Local disk storage (videos & images stay local) ──────────────────────────
const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const videoDir = path.join(uploadsDir, "videos");
const imageDir = path.join(uploadsDir, "images");
[videoDir, imageDir].forEach((d) => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

const videoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, videoDir),
  filename: (_req, file, cb) =>
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`),
});
const imageStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, imageDir),
  filename: (_req, file, cb) =>
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`),
});

const uploadVideo = multer({ storage: videoStorage, limits: { fileSize: 500 * 1024 * 1024 } });
const uploadImage = multer({ storage: imageStorage, limits: { fileSize: 10 * 1024 * 1024 } });

// ── Memory storage for payment proofs → uploaded to Supabase ─────────────────
const ALLOWED_PROOF_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const MAX_PROOF_SIZE = 10 * 1024 * 1024; // 10 MB

const proofUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PROOF_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_PROOF_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`FORMAT_NOT_SUPPORTED: Only JPG, JPEG, PNG, and WEBP are allowed. Got: ${file.mimetype}`));
    }
  },
});

// ── Local upload endpoints ────────────────────────────────────────────────────
router.post("/upload/video", authenticate, uploadVideo.single("file"), (req: Request, res: Response) => {
  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
  const url = `/api/uploads/videos/${req.file.filename}`;
  res.json({ url, filename: req.file.filename, size: req.file.size });
});

router.post("/upload/image", authenticate, uploadImage.single("file"), (req: Request, res: Response) => {
  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
  const url = `/api/uploads/images/${req.file.filename}`;
  res.json({ url, filename: req.file.filename, size: req.file.size });
});

// ── Payment proof → Supabase Storage ─────────────────────────────────────────
router.post(
  "/upload/payment-proof",
  authenticate,
  (req: Request, res: Response, next) => {
    proofUpload.single("file")(req, res, (err) => {
      if (!err) return next();

      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({
          error: "FILE_TOO_LARGE",
          message: `File melebihi batas maksimum 10 MB.`,
          detail: err.message,
        });
        return;
      }
      if (err instanceof Error && err.message.startsWith("FORMAT_NOT_SUPPORTED")) {
        res.status(415).json({
          error: "FORMAT_NOT_SUPPORTED",
          message: "Format file tidak didukung. Gunakan JPG, JPEG, PNG, atau WEBP.",
          detail: err.message,
        });
        return;
      }
      next(err);
    });
  },
  async (req: Request, res: Response) => {
    // Auth guard (middleware already ran, but belt-and-suspenders)
    if (!req.user) {
      res.status(401).json({ error: "UNAUTHORIZED", message: "Anda harus login untuk mengupload." });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "NO_FILE", message: "Tidak ada file yang dipilih." });
      return;
    }

    const userId = req.user.userId;
    const ext = path.extname(req.file.originalname).toLowerCase() || ".jpg";
    const filename = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    const storagePath = filename; // inside the bucket, folder = userId/

    logger.info({ userId, filename, size: req.file.size, mimetype: req.file.mimetype }, "Uploading payment proof to Supabase");

    try {
      const { data, error } = await supabase.storage
        .from(PAYMENT_BUCKET)
        .upload(storagePath, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: false,
        });

      if (error) {
        logger.error({ supabaseError: error, userId, filename }, "Supabase upload error");

        // Map common Supabase error codes to user-friendly messages
        let userMessage = error.message;
        let errorCode = "SUPABASE_ERROR";

        const msg = error.message?.toLowerCase() ?? "";
        if (msg.includes("bucket") && msg.includes("not found")) {
          errorCode = "BUCKET_NOT_FOUND";
          userMessage = `Bucket "${PAYMENT_BUCKET}" tidak ditemukan di Supabase. Buat bucket tersebut di dashboard Supabase Storage terlebih dahulu.`;
        } else if (msg.includes("permission") || msg.includes("policy") || msg.includes("violates")) {
          errorCode = "PERMISSION_DENIED";
          userMessage = "Akses ditolak oleh Supabase. Periksa policy RLS pada bucket.";
        } else if (msg.includes("already exists") || msg.includes("duplicate")) {
          errorCode = "DUPLICATE_FILE";
          userMessage = "File dengan nama yang sama sudah ada. Silakan coba lagi.";
        } else if (msg.includes("size") || msg.includes("too large")) {
          errorCode = "FILE_TOO_LARGE";
          userMessage = "File terlalu besar menurut konfigurasi Supabase.";
        }

        res.status(500).json({
          error: errorCode,
          message: userMessage,
          supabaseMessage: error.message,
          supabaseStatusCode: (error as any).statusCode ?? null,
        });
        return;
      }

      const publicUrl = getPublicUrl(PAYMENT_BUCKET, data.path);
      logger.info({ userId, path: data.path, publicUrl }, "Payment proof uploaded successfully");

      res.json({
        url: publicUrl,
        path: data.path,
        bucket: PAYMENT_BUCKET,
        filename,
        size: req.file.size,
      });
    } catch (err: any) {
      logger.error({ err, userId }, "Unexpected error during Supabase upload");
      res.status(502).json({
        error: "CONNECTION_FAILED",
        message: "Gagal menghubungi Supabase Storage. Periksa koneksi server.",
        detail: err?.message ?? String(err),
      });
    }
  },
);

// ── Debug endpoint: Supabase connection & bucket status ───────────────────────
router.get("/upload/debug", authenticate, async (req: Request, res: Response) => {
  const result: Record<string, any> = {
    supabaseUrl: process.env.SUPABASE_URL ?? "(not set)",
    serviceKeyPresent: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    bucket: PAYMENT_BUCKET,
    bucketStatus: null,
    bucketPublic: null,
    listError: null,
    uploadTestResult: null,
    uploadTestError: null,
    timestamp: new Date().toISOString(),
  };

  // 1. Check bucket exists
  try {
    const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
    if (listErr) {
      result.listError = { message: listErr.message, statusCode: (listErr as any).statusCode };
    } else {
      const bucket = (buckets ?? []).find((b: any) => b.name === PAYMENT_BUCKET);
      result.bucketStatus = bucket ? "found" : "NOT_FOUND";
      result.bucketPublic = bucket?.public ?? null;
    }
  } catch (e: any) {
    result.listError = { message: e?.message ?? String(e) };
  }

  // 2. Attempt a tiny test upload (1-pixel PNG)
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
      result.uploadTestError = {
        message: error.message,
        statusCode: (error as any).statusCode ?? null,
      };
    } else {
      result.uploadTestResult = "SUCCESS";
      result.uploadTestUrl = getPublicUrl(PAYMENT_BUCKET, data.path);
      // Clean up test file
      await supabase.storage.from(PAYMENT_BUCKET).remove([testPath]);
    }
  } catch (e: any) {
    result.uploadTestResult = "EXCEPTION";
    result.uploadTestError = { message: e?.message ?? String(e) };
  }

  res.json(result);
});

export default router;
