---
name: Multi-storage architecture
description: Three-provider storage system for Yzu视频 — Creator (Supabase 1), Verified Creator (Supabase 2), Owner (Bunny Stream)
---

# Multi-Storage Architecture

## Provider routing (by uploader badge)

| Badge | Provider | Env vars | Video folder | Thumb folder |
|-------|----------|----------|-------------|-------------|
| Creator | Supabase Project 1 | `CREATOR_SUPABASE_URL` + `CREATOR_SUPABASE_SERVICE_ROLE_KEY` | `yzx/creator/videos/` | `yzx/creator/thumbnails/` |
| Verified Creator | Supabase Project 2 | `VERIFIED_CREATOR_SUPABASE_URL` + `VERIFIED_CREATOR_SUPABASE_SERVICE_ROLE_KEY` | `yzx/verified-creator/videos/` | `yzx/verified-creator/thumbnails/` |
| Owner | Bunny Stream | `BUNNY_STREAM_LIBRARY_ID` + `BUNNY_STREAM_API_KEY` + `BUNNY_CDN_HOSTNAME` (optional) | Bunny Stream CDN | `yzx/owner/thumbnails/` (legacy Supabase) |
| (none) | Legacy Supabase | `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | `yzx/videos/` | `yzx/thumnails/` (typo!) |

Payment proofs ALWAYS go to Verified Creator Supabase Project 2 → `yzx/verified-creator/payments/{userId}/`. Falls back to legacy Supabase if VC credentials not set.

## Key files
- `artifacts/api-server/src/lib/storage/types.ts` — StorageService interface + result types
- `artifacts/api-server/src/lib/storage/creator.ts` — CreatorStorage (Supabase P1)
- `artifacts/api-server/src/lib/storage/verified-creator.ts` — VerifiedCreatorStorage (Supabase P2), also exports `uploadPaymentProof()`
- `artifacts/api-server/src/lib/storage/owner.ts` — OwnerStorage (Bunny Stream video, legacy Supabase thumb)
- `artifacts/api-server/src/lib/storage/index.ts` — factory: `getStorageService(type)`, `normalizeUploaderType(raw)`
- `artifacts/api-server/src/routes/upload.ts` — upload routes using the storage services
- `artifacts/api-server/src/lib/supabase.ts` — legacy single-client (untouched, still used for bundle/image uploads)

## Bunny Stream upload flow
1. POST `https://video.bunnycdn.com/library/{id}/videos` → get `guid` (videoId)
2. PUT `https://video.bunnycdn.com/library/{id}/videos/{guid}` with raw binary body
3. Playback URL: `https://{BUNNY_CDN_HOSTNAME}/{guid}/playlist.m3u8` (HLS) or embed fallback
4. `videoUrl` in Neon stores the playback URL; `bunnyVideoId`, `bunnyLibraryId`, `bunnyPlaybackUrl` stored in new columns

## DB columns added (videos table)
- `video_storage_provider` TEXT nullable — "supabase_creator" | "supabase_verified_creator" | "bunny_stream" | null
- `bunny_video_id` TEXT nullable — Bunny Stream video GUID
- `bunny_playback_url` TEXT nullable — Bunny embed iframe URL
- `bunny_library_id` TEXT nullable — Bunny library ID

## Debug endpoint
GET `/api/upload/debug` (authenticated) — shows status of all 4 storage providers.

**Why:** Each uploader badge maps to a dedicated storage project/service for security isolation and billing separation. Legacy uploads (no badge) continue using the single Supabase to preserve backward compatibility.

**How to apply:** When adding new upload-related features, call `getStorageService(normalizeUploaderType(req.body.uploaderType))` to resolve the correct service. For payment proofs specifically, always use `uploadPaymentProof()` (not the StorageService interface) so they always land in the VC project.
