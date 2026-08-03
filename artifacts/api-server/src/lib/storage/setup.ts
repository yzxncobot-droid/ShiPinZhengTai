/**
 * Storage bucket initialisation — runs once at server startup (best-effort).
 *
 * For each configured Supabase project (PUBLIC, OWNER, MEDIA):
 *   1. Validates that the env var is a service_role JWT (not anon).
 *      An anon key bypasses nothing — all uploads will fail with RLS errors.
 *   2. Ensures the `yzx` bucket exists and is set to public=true.
 *
 * All steps are best-effort: a failure logs a clear warning but never
 * prevents the server from starting.
 */

import { logger } from "../logger";
import { buildSupabaseClient, ensureBucket, getJwtRole } from "./supabase-helpers";

// ── Helpers ───────────────────────────────────────────────────────────────────

function validateKey(key: string, label: string): boolean {
  if (!key) return false;
  const role = getJwtRole(key);
  if (role === "service_role") {
    logger.info({ label }, "Storage key validated: service_role ✓");
    return true;
  }
  if (role === "anon") {
    logger.error(
      { label },
      `Storage: ${label} key is an ANON key — uploads will be rejected by Supabase RLS. ` +
      "Use the service_role key instead (Project Settings → API → service_role).",
    );
    return true; // configured, just wrong type
  }
  // Could not decode (very old or non-standard JWT) — warn but don't block
  logger.warn({ label, role }, "Storage: could not verify JWT role for key — proceeding anyway");
  return true;
}

// ── Per-project bucket setup ──────────────────────────────────────────────────

async function setupPublicStorage(): Promise<void> {
  const url = process.env.PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.PUBLIC_SUPABASE_SERVICE_KEY ?? "";
  if (!url || !key) {
    logger.warn("Storage setup: PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_SERVICE_KEY not set — skipping");
    return;
  }
  validateKey(key, "PUBLIC_SUPABASE_SERVICE_KEY");
  const client = buildSupabaseClient(url, key);
  await ensureBucket(client, "yzx", "PUBLIC project");
}

async function setupOwnerStorage(): Promise<void> {
  const url = process.env.OWNER_SUPABASE_URL ?? "";
  const key = process.env.OWNER_SUPABASE_SERVICE_KEY ?? "";
  if (!url || !key) {
    logger.warn("Storage setup: OWNER_SUPABASE_URL / OWNER_SUPABASE_SERVICE_KEY not set — skipping");
    return;
  }
  validateKey(key, "OWNER_SUPABASE_SERVICE_KEY");
  const client = buildSupabaseClient(url, key);
  await ensureBucket(client, "yzx", "OWNER project");
}

async function setupMediaStorage(): Promise<void> {
  const url    = process.env.MEDIA_SUPABASE_URL ?? "";
  const key    = process.env.MEDIA_SUPABASE_SERVICE_KEY ?? "";
  const bucket = process.env.MEDIA_SUPABASE_BUCKET ?? "yzx";
  if (!url || !key) {
    logger.warn("Storage setup: MEDIA_SUPABASE_URL / MEDIA_SUPABASE_SERVICE_KEY not set — skipping");
    return;
  }
  validateKey(key, "MEDIA_SUPABASE_SERVICE_KEY");
  const client = buildSupabaseClient(url, key);
  await ensureBucket(client, bucket, "MEDIA project");
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Best-effort: run all three bucket setup steps concurrently.
 * Never throws — each failure is logged as a warning.
 */
export async function ensureStorageBuckets(): Promise<void> {
  const steps = [
    setupPublicStorage().catch((e: any) =>
      logger.warn({ err: e?.message }, "Storage setup: PUBLIC bucket setup failed (non-fatal)"),
    ),
    setupOwnerStorage().catch((e: any) =>
      logger.warn({ err: e?.message }, "Storage setup: OWNER bucket setup failed (non-fatal)"),
    ),
    setupMediaStorage().catch((e: any) =>
      logger.warn({ err: e?.message }, "Storage setup: MEDIA bucket setup failed (non-fatal)"),
    ),
  ];
  await Promise.all(steps);
}
