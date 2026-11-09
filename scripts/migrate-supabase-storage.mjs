#!/usr/bin/env node
/**
 * Safe Supabase Storage Migration Script
 *
 * Transfers objects from legacy/external Supabase projects into the single unified Supabase project.
 *
 * Usage:
 *   SOURCE_SUPABASE_URL=https://old.supabase.co \
 *   SOURCE_SUPABASE_KEY=service_role_key \
 *   SOURCE_BUCKET=yzx \
 *   SUPABASE_URL=https://unified.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=unified_service_role_key \
 *   TARGET_BUCKET=yzx \
 *   node scripts/migrate-supabase-storage.mjs
 */

import { createClient } from "@supabase/supabase-js";

const sourceUrl = process.env.SOURCE_SUPABASE_URL;
const sourceKey = process.env.SOURCE_SUPABASE_KEY;
const sourceBucket = process.env.SOURCE_BUCKET || "yzx";

const targetUrl = process.env.SUPABASE_URL;
const targetKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const targetBucket = process.env.TARGET_BUCKET || "yzx";

if (!sourceUrl || !sourceKey || !targetUrl || !targetKey) {
  console.log(`
[Supabase Storage Migration Tool]
Usage:
  SOURCE_SUPABASE_URL=https://old-project.supabase.co \\
  SOURCE_SUPABASE_KEY=old-service-role-key \\
  SOURCE_BUCKET=yzx \\
  SUPABASE_URL=https://unified-project.supabase.co \\
  SUPABASE_SERVICE_ROLE_KEY=unified-service-role-key \\
  TARGET_BUCKET=yzx \\
  node scripts/migrate-supabase-storage.mjs
`);
  process.exit(1);
}

const sourceClient = createClient(sourceUrl, sourceKey, { auth: { persistSession: false } });
const targetClient = createClient(targetUrl, targetKey, { auth: { persistSession: false } });

async function listAllFiles(client, bucket, folder = "") {
  const { data, error } = await client.storage.from(bucket).list(folder, { limit: 1000 });
  if (error) {
    console.error(`Error listing folder "${folder}":`, error.message);
    return [];
  }
  let files = [];
  for (const item of data || []) {
    const fullPath = folder ? `${folder}/${item.name}` : item.name;
    if (item.id === null) {
      // item is a directory
      const subFiles = await listAllFiles(client, bucket, fullPath);
      files = files.concat(subFiles);
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

async function migrate() {
  console.log(`Starting migration from ${sourceUrl} (${sourceBucket}) to ${targetUrl} (${targetBucket})...`);

  // Ensure target bucket exists
  const { data: buckets } = await targetClient.storage.listBuckets();
  const exists = (buckets || []).some((b) => b.name === targetBucket);
  if (!exists) {
    console.log(`Creating target bucket "${targetBucket}" (public)...`);
    const { error: createErr } = await targetClient.storage.createBucket(targetBucket, { public: true });
    if (createErr) {
      console.warn(`Could not create bucket (may already exist):`, createErr.message);
    }
  }

  const allFiles = await listAllFiles(sourceClient, sourceBucket);
  console.log(`Found ${allFiles.length} files in source bucket.`);

  let successCount = 0;
  let failCount = 0;

  for (const filePath of allFiles) {
    try {
      console.log(`Migrating: ${filePath}...`);
      const { data: fileData, error: downloadErr } = await sourceClient.storage
        .from(sourceBucket)
        .download(filePath);

      if (downloadErr) {
        console.error(`Failed to download ${filePath}:`, downloadErr.message);
        failCount++;
        continue;
      }

      const buffer = Buffer.from(await fileData.arrayBuffer());
      const { error: uploadErr } = await targetClient.storage
        .from(targetBucket)
        .upload(filePath, buffer, { upsert: true, contentType: fileData.type || "application/octet-stream" });

      if (uploadErr) {
        console.error(`Failed to upload ${filePath}:`, uploadErr.message);
        failCount++;
      } else {
        successCount++;
      }
    } catch (err) {
      console.error(`Unexpected error for ${filePath}:`, err);
      failCount++;
    }
  }

  console.log(`Migration finished. Successfully transferred: ${successCount}, Failed: ${failCount}`);
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
