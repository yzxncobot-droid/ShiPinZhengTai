import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) throw new Error("SUPABASE_URL environment variable is required");
if (!supabaseKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY environment variable is required");

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const PAYMENT_BUCKET = "payments";

/** Bucket used for video content: videos, thumbnails, and misc site images. */
export const MEDIA_BUCKET = "yzx";

/** Build a public URL for a Supabase Storage object */
export function getPublicUrl(bucket: string, path: string): string {
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${path}`;
}
