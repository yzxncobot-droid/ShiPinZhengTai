/**
 * Storage bucket initialisation — runs once at server startup (best-effort).
 *
 * For the unified Supabase project:
 *   1. Validates that the env var is a service_role JWT (not anon).
 *      An anon key bypasses nothing — all uploads will fail with RLS errors.
 *   2. Ensures the `yzx` bucket exists and is set to public=true.
 *   3. Populates folder structures for all role-based folders and media assets.
 *
 * All steps are best-effort: a failure logs a clear warning but never
 * prevents the server from starting.
 */

import { logger } from "../logger";
import {
  ensureBucket,
  ensureFolderStructure,
  getJwtRole,
  unifiedSupabaseClient as client,
  UNIFIED_SUPABASE_URL,
  UNIFIED_SUPABASE_KEY,
  UNIFIED_BUCKET,
} from "./supabase-helpers";

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

// ── Unified bucket setup ──────────────────────────────────────────────────────

async function setupUnifiedStorage(): Promise<void> {
  const url = UNIFIED_SUPABASE_URL;
  const key = UNIFIED_SUPABASE_KEY;
  if (!url || !key) {
    logger.warn("Storage setup: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — skipping");
    return;
  }
  validateKey(key, "SUPABASE_SERVICE_ROLE_KEY");
  await ensureBucket(client, UNIFIED_BUCKET, "Unified Supabase project");
  await ensureFolderStructure(client, UNIFIED_BUCKET, "Unified Supabase project");
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Best-effort: run unified bucket setup.
 * Never throws — failures are logged as warnings.
 */
export async function ensureStorageBuckets(): Promise<void> {
  try {
    await setupUnifiedStorage();
  } catch (e: any) {
    logger.warn({ err: e?.message }, "Storage setup: unified bucket setup failed (non-fatal)");
  }
}
