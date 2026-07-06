import { Router, Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { authenticate } from "../middlewares/auth";

const router = Router();

const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const videoDir = path.join(uploadsDir, "videos");
const imageDir = path.join(uploadsDir, "images");
const proofDir = path.join(uploadsDir, "proofs");
[videoDir, imageDir, proofDir].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

const videoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, videoDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`),
});

const imageStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, imageDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`),
});

const proofStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, proofDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`),
});

const uploadVideo = multer({ storage: videoStorage, limits: { fileSize: 500 * 1024 * 1024 } });
const uploadImage = multer({ storage: imageStorage, limits: { fileSize: 10 * 1024 * 1024 } });
const uploadProof = multer({ storage: proofStorage, limits: { fileSize: 10 * 1024 * 1024 } });

const BASE_URL = process.env.BASE_PATH || "/api";

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

router.post("/upload/payment-proof", authenticate, uploadProof.single("file"), (req: Request, res: Response) => {
  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
  const url = `/api/uploads/proofs/${req.file.filename}`;
  res.json({ url, filename: req.file.filename, size: req.file.size });
});

export default router;
