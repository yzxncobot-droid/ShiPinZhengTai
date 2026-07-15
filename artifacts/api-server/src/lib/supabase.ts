import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) throw new Error("SUPABASE_URL environment variable is required");
if (!supabaseKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY environment variable is required");

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * Single consolidated media bucket.
 * Sub-folders:
 *  - videos/     → uploaded video files
 *  - thumnails/  → video thumbnails (typo preserved from bucket naming)
 *  - images/     → generic site images (avatars, logos, banners, QRIS)
 *  - payments/   → payment proof screenshots
 */
export const MEDIA_BUCKET = "yzx";

/**
 * @deprecated alias kept for call-sites that haven't been updated yet.
 * Points to the consolidated MEDIA_BUCKET so uploads still land in the
 * right place while old references are gradually cleaned up.
 */
export const PAYMENT_BUCKET = MEDIA_BUCKET;

/** Sub-folder within MEDIA_BUCKET where payment proofs are stored. */
export const PAYMENTS_FOLDER = "payments";

/** Build a public URL for a Supabase Storage object */
export function getPublicUrl(bucket: string, path: string): string {
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${path}`;
}

/**
 * Upload a buffer to a Supabase Storage bucket with automatic retry.
 * Retries up to `maxRetries` times with exponential back-off.
 */
export async function uploadWithRetry(
  bucket: string,
  path: string,
  buffer: Buffer,
  contentType: string,
  opts: { upsert?: boolean; maxRetries?: number } = {},
): Promise<{ path: string; url: string }> {
  const { upsert = false, maxRetries = 3 } = opts;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(path, buffer, { contentType, upsert });

    if (!error) {
      return { path: data.path, url: getPublicUrl(bucket, data.path) };
    }

    lastError = new Error(error.message);

    // Don't retry on client-side errors (4xx)
    const status = (error as any).statusCode ?? (error as any).status ?? 500;
    if (status >= 400 && status < 500) break;

    if (attempt < maxRetries) {
      // Exponential back-off: 500 ms, 1 s, 2 s …
      await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
    }
  }

  throw lastError ?? new Error("Upload failed after retries");
}
