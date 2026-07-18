---
name: Upload bucket fix
description: Root causes of upload bucket-not-found errors and category edit 500 errors
---

## Bucket name was wrong
`MEDIA_BUCKET` defaulted to `"Yzu"` (capital Y) — actual Supabase bucket is `"yzx"`.
Fixed in `artifacts/api-server/src/lib/supabase.ts`.

**Why:** The bucket was renamed at some point but the code default was never updated.

## Thumbnail folder has a typo — intentional
Supabase folder is `"thumnails"` (missing 'a'), NOT `"thumbnails"`.
`FOLDER_THUMBNAILS = "thumnails"` — this is correct.

## categoryId is UUID, not integer
Frontend `admin/videos.tsx` used `parseInt(categoryId_uuid)` → e.g. `parseInt("7a6b94b9-...")` = 7 (wrong).
Fixed: use raw string `v || null` in `onValueChange`.

**Why:** categoryId is `uuid` in the DB schema (`lib/db/src/schema/videos.ts:56`).

## PATCH /videos/:id had no try/catch
Any DB error (foreign key, schema mismatch) caused unhandled 500.
Fixed: added try/catch with pgCode detection (23503 = FK violation → "kategori tidak ditemukan").

## Bundle upload routes added
New endpoints: `POST /api/upload/bundle-video` → `yzx/bundles/`
                `POST /api/upload/bundle-thumbnail` → `yzx/bundle-thumbnails/`
