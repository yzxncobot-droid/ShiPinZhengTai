import { Router } from "express";
import multer from "multer";
import { authenticate } from "../middlewares/auth";
import { uploadToMediaStorage, isMediaStorageAvailable } from "../lib/storage/media";
import { logger } from "../lib/logger";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter(_, file, cb) {
    const allowed = [
      "image/jpeg", "image/png", "image/webp", "image/gif",
      "video/mp4", "video/quicktime", "video/webm",
      "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/zip", "audio/webm", "audio/ogg", "audio/mpeg",
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed`));
    }
  },
});

/**
 * Map a MIME type to:
 *   - `assetType`  → Media Supabase folder (media/chat/…)
 *   - `folder`     → legacy folder name the frontend uses to detect message type
 */
const TYPE_MAP: Record<string, { assetType: string; folder: string }> = {
  "image/jpeg":              { assetType: "chat-image", folder: "chat-images" },
  "image/png":               { assetType: "chat-image", folder: "chat-images" },
  "image/webp":              { assetType: "chat-image", folder: "chat-images" },
  "image/gif":               { assetType: "chat-image", folder: "chat-images" },
  "video/mp4":               { assetType: "chat-video", folder: "chat-videos" },
  "video/quicktime":         { assetType: "chat-video", folder: "chat-videos" },
  "video/webm":              { assetType: "chat-video", folder: "chat-videos" },
  "application/pdf":         { assetType: "chat-file",  folder: "chat-files" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
                             { assetType: "chat-file",  folder: "chat-files" },
  "application/zip":         { assetType: "chat-file",  folder: "chat-files" },
  "audio/webm":              { assetType: "chat-voice", folder: "voice-notes" },
  "audio/ogg":               { assetType: "chat-voice", folder: "voice-notes" },
  "audio/mpeg":              { assetType: "chat-voice", folder: "voice-notes" },
};

router.post("/chat/upload", authenticate, upload.single("file"), async (req, res) => {
  if (!isMediaStorageAvailable) {
    res.status(503).json({ error: "Media storage not configured" });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  try {
    const mapping = TYPE_MAP[req.file.mimetype] ?? { assetType: "chat-file", folder: "chat-files" };

    const { url, path: storagePath } = await uploadToMediaStorage(mapping.assetType, req.file);

    logger.info(
      { folder: mapping.folder, path: storagePath, size: req.file.size, mime: req.file.mimetype },
      "chat-upload: MEDIA Supabase upload SUCCESS",
    );

    res.json({
      url,
      path: storagePath,
      fileName: req.file.originalname,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      folder: mapping.folder,
    });
  } catch (err: any) {
    logger.error({ err }, "chat-upload: MEDIA Supabase upload FAILED");
    res.status(500).json({ error: err.message });
  }
});

export default router;
