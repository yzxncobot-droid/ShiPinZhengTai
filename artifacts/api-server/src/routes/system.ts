import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { authenticate, requireRole } from "../middlewares/auth";
import { redis, isRedisAvailable } from "../lib/redis";
import {
  supabase, MEDIA_BUCKET,
  FOLDER_VIDEOS, FOLDER_THUMBNAILS, FOLDER_IMAGES,
  FOLDER_PAYMENTS, FOLDER_BUNDLES, FOLDER_BUNDLE_THUMBNAILS,
} from "../lib/supabase";
import { sql } from "drizzle-orm";

const router = Router();

const BUCKET_CHECKS = [
  { key: "videos",            folder: FOLDER_VIDEOS,            label: `${MEDIA_BUCKET}/${FOLDER_VIDEOS}` },
  { key: "thumbnails",        folder: FOLDER_THUMBNAILS,        label: `${MEDIA_BUCKET}/${FOLDER_THUMBNAILS}` },
  { key: "payments",          folder: FOLDER_PAYMENTS,          label: `${MEDIA_BUCKET}/${FOLDER_PAYMENTS}` },
  { key: "bundles",           folder: FOLDER_BUNDLES,           label: `${MEDIA_BUCKET}/${FOLDER_BUNDLES}` },
  { key: "bundleThumbnails",  folder: FOLDER_BUNDLE_THUMBNAILS, label: `${MEDIA_BUCKET}/${FOLDER_BUNDLE_THUMBNAILS}` },
];

router.get("/system/status", authenticate, requireRole("owner", "admin"), async (_req, res) => {
  const result: Record<string, any> = {
    timestamp: new Date().toISOString(),
    database: { status: "unknown", latencyMs: null },
    redis:    { status: "unknown", latencyMs: null },
    supabase: { status: "unknown", bucket: MEDIA_BUCKET, buckets: {} },
    environment: {
      nodeVersion: process.version,
      nodeEnv: process.env.NODE_ENV || "development",
      supabaseUrl: process.env.SUPABASE_URL
        ? process.env.SUPABASE_URL.replace(/https?:\/\//, "").split(".")[0] + ".supabase.co"
        : "(not set)",
      sessionSecretSet: !!process.env.SESSION_SECRET,
      jwtSecretSet: !!process.env.JWT_SECRET,
      databaseUrlSet: !!(process.env.NEON_DATABASE_URL || process.env.DATABASE_URL),
      neonUrlSet: !!process.env.NEON_DATABASE_URL,
      supabaseKeySet: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      layerbaseKvSet: !!process.env.KV_REST_API_URL,
    },
    memory: {
      heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    },
    uptime: {
      seconds: Math.round(process.uptime()),
      formatted: formatUptime(process.uptime()),
    },
  };

  // DB health check
  const dbStart = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    result.database = { status: "healthy", latencyMs: Date.now() - dbStart };
  } catch (e: any) {
    result.database = { status: "error", error: e?.message, latencyMs: Date.now() - dbStart };
  }

  // Redis health check
  const redisStart = Date.now();
  try {
    if (!isRedisAvailable) {
      result.redis = { status: "unavailable", latencyMs: null };
    } else {
      await redis.ping();
      result.redis = { status: "healthy", latencyMs: Date.now() - redisStart };
    }
  } catch (e: any) {
    result.redis = { status: "error", error: e?.message, latencyMs: Date.now() - redisStart };
  }

  // Supabase + bucket checks
  try {
    const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
    if (listErr) {
      result.supabase = { status: "error", error: listErr.message, bucket: MEDIA_BUCKET, buckets: {} };
    } else {
      const bucketList = (buckets ?? []).map((b: any) => ({ name: b.name, public: b.public }));
      const mainBucket = (buckets ?? []).find((b: any) => b.name === MEDIA_BUCKET);

      // Check each expected folder inside the bucket
      const folderChecks: Record<string, any> = {};
      for (const check of BUCKET_CHECKS) {
        try {
          const { data, error } = await supabase.storage
            .from(MEDIA_BUCKET)
            .list(check.folder, { limit: 1 });
          folderChecks[check.key] = {
            label: check.label,
            status: error ? "error" : "ok",
            error: error?.message ?? null,
          };
        } catch (e: any) {
          folderChecks[check.key] = { label: check.label, status: "error", error: e?.message };
        }
      }

      result.supabase = {
        status: mainBucket ? "healthy" : "bucket_missing",
        bucket: MEDIA_BUCKET,
        bucketExists: !!mainBucket,
        bucketPublic: mainBucket?.public ?? null,
        allBuckets: bucketList,
        folders: folderChecks,
      };
    }
  } catch (e: any) {
    result.supabase = { status: "error", error: e?.message, bucket: MEDIA_BUCKET, buckets: {} };
  }

  res.json(result);
});

router.get("/system/storage", authenticate, requireRole("owner", "admin"), async (_req, res) => {
  try {
    const { data: objects, error } = await supabase.storage.from(MEDIA_BUCKET).list("", { limit: 1000 });
    if (error) {
      res.json({ bucket: MEDIA_BUCKET, totalFiles: 0, error: error.message });
      return;
    }
    const totalSize = (objects || []).reduce((sum: number, obj: any) => sum + (obj.metadata?.size || 0), 0);
    res.json({
      bucket: MEDIA_BUCKET,
      totalFiles: (objects || []).length,
      totalSizeMB: Math.round(totalSize / 1024 / 1024 * 100) / 100,
    });
  } catch (e: any) {
    res.json({ bucket: MEDIA_BUCKET, totalFiles: 0, error: e?.message });
  }
});

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

export default router;
