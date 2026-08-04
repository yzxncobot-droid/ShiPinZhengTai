import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import path from "path";
import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import { usersTable, customRolesTable, userCustomRolesTable } from "@workspace/db";
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

/**
 * Resolve the authoritative NormalizedUploaderType for an authenticated user.
 *
 * Security contract:
 *   - Admin / Owner with explicit uploaderType: trusted (they select storage on
 *     the admin upload page). Explicit type is passed through as-is.
 *   - Admin / Owner WITHOUT explicit uploaderType: they reach this via profile
 *     dropdown — check their custom roles for permUploadVideo.
 *   - All other users: permission is determined from active custom roles.
 *     Client-supplied uploaderType is ignored (always "creator" for PUBLIC storage).
 *
 * Permission source: custom_roles.perm_upload_video (never badge flags).
 *
 * Returns:
 *   { type: NormalizedUploaderType | null }  — null means "use legacy route"
 *   { error: string; status: number }         — caller should return this HTTP error
 */
async function resolveUploaderType(
  userId: string,
  userRole: string,
  clientUploaderType: string | undefined,
): Promise<{ type: NormalizedUploaderType | null } | { error: string; status: number }> {
  const isAdminOrOwner = ["admin", "owner"].includes(userRole);

  if (isAdminOrOwner && clientUploaderType) {
    // Admin/Owner explicitly chose a storage type (admin upload page).
    // Trust the explicit value; null means fall back to legacy.
    const normalized = normalizeUploaderType(clientUploaderType);
    return { type: normalized }; // may be null (legacy) or a specific type
  }

  // Check custom role permissions — this is now the sole source of upload access.
  // Client-supplied uploaderType is ignored for all non-admin/owner users.
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
      // All custom-role creators always route to PUBLIC Supabase as "creator"
      return { type: "creator" };
    }
  } catch (err) {
    logger.error({ userId, err }, "resolveUploaderType: DB custom-role lookup failed");
    return { error: "Gagal memeriksa izin upload.", status: 500 };
  }

  // No upload permission found
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
//
//  Storage routing is always resolved server-side from authenticated user flags:
//    verifiedCreator = true  → PUBLIC Supabase (verified-creator folder)
//    creatorBadge = true     → PUBLIC Supabase (creator folder)
//    admin / owner           → OWNER Supabase (or client-selected storage)
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

    const userRole = req.user?.role ?? "";
    const isAdminOrOwner = ["admin", "owner"].includes(userRole);

    // Resolve storage tier server-side (never trust client for creator tier)
    const resolved = await resolveUploaderType(
      req.user!.userId,
      userRole,
      req.body?.uploaderType as string | undefined,
    );

    if ("error" in resolved) {
      return res.status(resolved.status).json({ success: false, message: resolved.error });
    }

    const normalized = resolved.type;

    // ── Multi-storage route (Creator / Verified Creator / Owner) ──────────────
    if (normalized) {
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

    // ── Legacy route (no uploader type — admin/owner without explicit type) ────
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
//  Storage routing is always resolved server-side (mirrors video upload):
//    verifiedCreator = true  → PUBLIC Supabase (verified-creator thumbnails)
//    creatorBadge = true     → PUBLIC Supabase (creator thumbnails)
//    admin / owner           → client-selected storage, or legacy if omitted
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

    const userRole = req.user?.role ?? "";

    // Resolve storage tier server-side (creator tier is never client-trusted)
    const resolved = await resolveUploaderType(
      req.user!.userId,
      userRole,
      req.body?.uploaderType as string | undefined,
    );

    if ("error" in resolved) {
      return res.status(resolved.status).json({ success: false, message: resolved.error });
    }

    const normalized = resolved.type;

    // ── Multi-storage route ───────────────────────────────────────────────────
    if (normalized) {
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

    // ── Legacy route (admin/owner with no explicit uploaderType) ──────────────
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

// ── Generic image upload → MEDIA Supabase (avatars, QRIS, banners, logos…) ───
//
//  Accepts an optional `assetType` body field to route to the correct
//  sub-folder inside the MEDIA bucket:
//    "avatar"           → media/avatars/
//    "qris"             → media/qris/
//    "banner"           → media/banners/
//    "bundle-thumbnail" → media/bundle-thumbnails/
//    "bundle-banner"    → media/bundle-banners/
//    "logo"             → media/logos/
//    (omitted)          → media/images/   ← backward-compat default
//
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
      res.status(503).json({ success: false, message: "Media storage belum dikonfigurasi (MEDIA_SUPABASE_URL / MEDIA_SUPABASE_SERVICE_KEY). Hubungi administrator." });
      return;
    }
    const assetType = req.body?.assetType as string | undefined;
    try {
      const { path: storedPath, url, folder } = await uploadToMediaStorage(assetType, req.file);
      res.json({ success: true, url, path: storedPath, filename: storedPath, size: req.file.size, bucket: "yzx", folder, assetType: assetType ?? "images" });
    } catch (err: any) {
      logger.error({ assetType, err }, "Image upload failed (media storage)");
      res.status(500).json({ success: false, message: friendlyUploadError(err, `media/${assetType ?? "images"}`), detail: err?.message });
    }
  },
);

// ── Bundle video upload → public/bundles/ (PUBLIC Supabase) ──────────────────
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
      res.status(503).json({ success: false, message: "Storage belum dikonfigurasi. Hubungi administrator." });
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

// ── Bundle thumbnail upload → MEDIA Supabase (media/bundle-thumbnails/) ──────
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
      res.status(503).json({ success: false, message: "Media storage belum dikonfigurasi (MEDIA_SUPABASE_URL / MEDIA_SUPABASE_SERVICE_KEY). Hubungi administrator." });
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
  const { buildSupabaseClient, getJwtRole } = await import("../lib/storage/supabase-helpers");

  /** Live-test a Supabase project: list buckets and check bucket existence. */
  async function probeProject(url: string, key: string, bucket: string) {
    if (!url || !key) return { status: "not_configured" };
    const keyRole = getJwtRole(key);
    const client  = buildSupabaseClient(url, key);
    try {
      const { data: buckets, error } = await client.storage.listBuckets();
      if (error) return { status: "error", keyRole, error: error.message };
      const found = (buckets ?? []).find((b: any) => b.name === bucket);
      return {
        status: "ok",
        keyRole,
        bucket,
        bucketExists: !!found,
        bucketPublic: found?.public ?? null,
        allBuckets: (buckets ?? []).map((b: any) => ({ name: b.name, public: b.public })),
        warning: keyRole !== "service_role"
          ? `Key role is "${keyRole}" — only service_role bypasses RLS. Uploads will fail!`
          : undefined,
      };
    } catch (e: any) {
      return { status: "connect_error", keyRole, error: e?.message };
    }
  }

  const mediaBucket = process.env.MEDIA_SUPABASE_BUCKET ?? "yzx";

  const [publicProbe, ownerProbe, mediaProbe] = await Promise.all([
    probeProject(
      process.env.PUBLIC_SUPABASE_URL ?? "",
      process.env.PUBLIC_SUPABASE_SERVICE_KEY ?? "",
      "yzx",
    ),
    probeProject(
      process.env.OWNER_SUPABASE_URL ?? "",
      process.env.OWNER_SUPABASE_SERVICE_KEY ?? "",
      "yzx",
    ),
    probeProject(
      process.env.MEDIA_SUPABASE_URL ?? "",
      process.env.MEDIA_SUPABASE_SERVICE_KEY ?? "",
      mediaBucket,
    ),
  ]);

  // Legacy probe
  let legacyProbe: Record<string, any> = { status: "not_configured" };
  if (isSupabaseAvailable) {
    try {
      const { data: buckets, error } = await supabase.storage.listBuckets();
      legacyProbe = error
        ? { status: "error", error: error.message }
        : {
            status: "ok",
            keyRole: getJwtRole(process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""),
            buckets: (buckets ?? []).map((b: any) => ({ name: b.name, public: b.public })),
          };
    } catch (e: any) {
      legacyProbe = { status: "connect_error", error: e?.message };
    }
  }

  res.json({
    timestamp: new Date().toISOString(),
    architecture: "PUBLIC + OWNER + MEDIA (3 Supabase projects)",
    note: "All uploads use service_role keys server-side — RLS is bypassed. " +
          "If keyRole shows 'anon', replace the secret with the service_role key.",
    storageProviders: {
      publicSupabase: {
        description: "Creator + Verified Creator video uploads",
        url:         process.env.PUBLIC_SUPABASE_URL ?? "(not set)",
        available:   isCreatorStorageAvailable,
        folders: {
          creatorVideos:      "public/creator/videos",
          creatorThumbs:      "public/creator/thumbnails",
          vcVideos:           "public/verified-creator/videos",
          vcThumbs:           "public/verified-creator/thumbnails",
          vcPayments:         "public/verified-creator/payments",
        },
        probe: publicProbe,
      },
      ownerSupabase: {
        description: "Owner / Admin video uploads",
        url:         process.env.OWNER_SUPABASE_URL ?? "(not set)",
        available:   isOwnerStorageAvailable,
        folders: { videos: "owner/videos", thumbnails: "owner/thumbnails" },
        probe: ownerProbe,
      },
      mediaSupabase: {
        description: "Avatars, QRIS, banners, bundle images",
        url:         process.env.MEDIA_SUPABASE_URL ?? "(not set)",
        available:   isMediaStorageAvailable,
        bucket:      mediaBucket,
        folders: {
          avatars: "media/avatars", qris: "media/qris", banners: "media/banners",
          bundleThumbnails: "media/bundle-thumbnails", bundleBanners: "media/bundle-banners",
          logos: "media/logos", images: "media/images",
        },
        probe: mediaProbe,
      },
      legacy: {
        description: "Pre-migration uploads (backward-compat read-only)",
        url:         process.env.SUPABASE_URL ?? "(not set)",
        available:   isSupabaseAvailable,
        bucket:      MEDIA_BUCKET,
        probe:       legacyProbe,
      },
    },
  });
});

export default router;
