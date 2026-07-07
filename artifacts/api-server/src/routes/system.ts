import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { authenticate, requireRole } from "../middlewares/auth";
import { supabase, PAYMENT_BUCKET } from "../lib/supabase";
import { sql } from "drizzle-orm";

const router = Router();

router.get("/system/status", authenticate, requireRole("owner", "admin"), async (req, res) => {
  const result: Record<string, any> = {
    timestamp: new Date().toISOString(),
    database: { status: "unknown", latencyMs: null },
    supabase: { status: "unknown", bucket: PAYMENT_BUCKET },
    environment: {
      nodeVersion: process.version,
      nodeEnv: process.env.NODE_ENV || "development",
      supabaseUrl: process.env.SUPABASE_URL ? process.env.SUPABASE_URL.replace(/https?:\/\//, "").split(".")[0] + ".supabase.co" : "(not set)",
      sessionSecretSet: !!process.env.SESSION_SECRET,
      databaseUrlSet: !!process.env.DATABASE_URL,
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

  // Supabase health check
  try {
    const { data, error } = await supabase.storage.listBuckets();
    if (error) {
      result.supabase = { status: "error", error: error.message, bucket: PAYMENT_BUCKET };
    } else {
      const bucket = (data || []).find((b: any) => b.name === PAYMENT_BUCKET);
      result.supabase = {
        status: "healthy",
        bucket: PAYMENT_BUCKET,
        bucketExists: !!bucket,
        bucketPublic: bucket?.public ?? null,
      };
    }
  } catch (e: any) {
    result.supabase = { status: "error", error: e?.message, bucket: PAYMENT_BUCKET };
  }

  res.json(result);
});

router.get("/system/storage", authenticate, requireRole("owner", "admin"), async (req, res) => {
  try {
    const { data: objects, error } = await supabase.storage.from(PAYMENT_BUCKET).list("", { limit: 1000 });
    if (error) {
      res.json({ bucket: PAYMENT_BUCKET, totalFiles: 0, error: error.message });
      return;
    }
    const totalSize = (objects || []).reduce((sum: number, obj: any) => sum + (obj.metadata?.size || 0), 0);
    res.json({
      bucket: PAYMENT_BUCKET,
      totalFiles: (objects || []).length,
      totalSizeMB: Math.round(totalSize / 1024 / 1024 * 100) / 100,
    });
  } catch (e: any) {
    res.json({ bucket: PAYMENT_BUCKET, totalFiles: 0, error: e?.message });
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
