import { Router } from "express";
import multer from "multer";
import { authenticate } from "../middlewares/auth";
import { uploadWithRetry, MEDIA_BUCKET, isSupabaseAvailable } from "../lib/supabase";
import { randomUUID } from "crypto";
import path from "path";

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

const FOLDER_MAP: Record<string, string> = {
  "image/jpeg": "chat-images",
  "image/png": "chat-images",
  "image/webp": "chat-images",
  "image/gif": "chat-images",
  "video/mp4": "chat-videos",
  "video/quicktime": "chat-videos",
  "video/webm": "chat-videos",
  "application/pdf": "chat-files",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "chat-files",
  "application/zip": "chat-files",
  "audio/webm": "voice-notes",
  "audio/ogg": "voice-notes",
  "audio/mpeg": "voice-notes",
};

router.post("/chat/upload", authenticate, upload.single("file"), async (req, res) => {
  if (!isSupabaseAvailable) {
    res.status(503).json({ error: "Storage not configured" });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  try {
    const folder = FOLDER_MAP[req.file.mimetype] ?? "chat-files";
    const ext = path.extname(req.file.originalname) || "";
    const filename = `${randomUUID()}${ext}`;
    const storagePath = `${folder}/${filename}`;

    const { url } = await uploadWithRetry(
      MEDIA_BUCKET,
      storagePath,
      req.file.buffer,
      req.file.mimetype,
      { upsert: false },
    );

    res.json({
      url,
      path: storagePath,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      folder,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
