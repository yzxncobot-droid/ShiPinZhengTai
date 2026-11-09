---
name: Storage architecture v2 (PUBLIC + OWNER)
description: Dual-Supabase storage layout — Creator+VerifiedCreator go to PUBLIC project, Owner goes to OWNER project. Bunny Stream no longer used for new uploads.
---

## The rule
- All roles (Creator / Verified Creator / Owner / Admin / Media) → Unified Supabase (`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`)
- Bunny Stream rows in DB have `video_storage_provider = 'bunny_stream'` and `storage_type = NULL` — they are NOT reclassified as OWNER; their video_url is a direct CDN/embed URL, not an OWNER Supabase URL.

**Why:** User requested consolidation from 3 storage projects (Creator, VerifiedCreator, Bunny) to 2 (PUBLIC, OWNER) for simpler management and clearer access control.

## Critical operational caveat
OWNER uploads require `admin` or `owner` JWT role — enforced server-side in the upload route. Changing this check requires updating both `POST /upload/video` and `POST /upload/thumbnail` in `upload.ts`.

## Node 20 + supabase-js v2 quirk
supabase-js v2.110+ requires WebSocket even for Storage-only use. `supabase-helpers.ts` polyfills `global.WebSocket` with the `ws` package at module load. If `ws` is ever removed as a dependency, the server will crash at boot.
