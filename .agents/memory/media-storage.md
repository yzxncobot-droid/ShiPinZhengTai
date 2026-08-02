---
name: Media storage (MEDIA Supabase project)
description: Dedicated Supabase project for all non-video media assets — avatars, QRIS, banners, bundle images. Added as Project 3 alongside PUBLIC (video) and OWNER (video).
---

## The rule
All generic image uploads (`POST /upload/image`) and bundle thumbnail uploads (`POST /upload/bundle-thumbnail`) go to the MEDIA Supabase project.

- `MEDIA_SUPABASE_URL` + `MEDIA_SUPABASE_SERVICE_KEY` (required)
- `MEDIA_SUPABASE_BUCKET` (optional, default `yzx`)

## Folder layout inside MEDIA bucket
| assetType | folder |
|-----------|--------|
| `avatar` | `media/avatars/` |
| `qris` | `media/qris/` |
| `banner` | `media/banners/` |
| `bundle-thumbnail` | `media/bundle-thumbnails/` |
| `bundle-banner` | `media/bundle-banners/` |
| `logo` | `media/logos/` |
| (default) | `media/images/` |

## assetType routing
Frontend appends `assetType` to FormData before calling `POST /upload/image`:
- `profile.tsx` → `avatar`
- `owner/settings.tsx` → `qrisImage` alias → `qris`; `banner` → `banner`
- `admin/settings.tsx` → `logo`/`favicon` → `logo`; `qrisImage` → `qris`
- `admin/bundles.tsx` → `thumbnail` → `bundle-thumbnail`; `banner` → `bundle-banner`
- `admin/maintenance.tsx` → `banner`

Server-side: `resolveMediaAssetType(raw)` in `media.ts` normalises aliases.

## Key files
- `artifacts/api-server/src/lib/storage/media.ts` — storage module
- `artifacts/api-server/src/lib/storage/index.ts` — exports
- `artifacts/api-server/src/routes/upload.ts` — routes use `isMediaStorageAvailable` + `uploadToMediaStorage`

**Why:** Separate media assets (images, thumbnails) from video content (PUBLIC/OWNER) for cleaner access control and easier quota/cost management per asset class.

**How to apply:** If adding a new image upload anywhere, import `isMediaStorageAvailable` and `uploadToMediaStorage(assetType, file)` from `../lib/storage` and pass the appropriate assetType string.
