---
name: Supabase bucket configuration
description: Actual Supabase bucket name and how it's configured; bucket vs code default mismatch history.
---

# Supabase bucket configuration

## Rule
The real Supabase bucket is **`yzx`** (public), confirmed working via the `/api/upload/debug` endpoint.
The bucket name is overridden via env vars (shared environment):
- `SUPABASE_VIDEOS_BUCKET=yzx`
- `SUPABASE_THUMBNAILS_BUCKET=yzx`
- `SUPABASE_PAYMENTS_BUCKET=yzx`

The code default in `supabase.ts` is `"Yzu"` (changed after a brief asked for that), but env vars take precedence — effective bucket is always `yzx`.

## Sub-folders within `yzx`
- `videos/`     — uploaded video files
- `thumbnails/` — video thumbnails (**fixed typo**: was `thumnails/`)
- `images/`     — avatars, logos, banners, QRIS
- `payments/`   — payment proof screenshots

## Secrets required at startup
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — service role key (full access)

**Why:** Without these, `isSupabaseAvailable` is false and all upload endpoints return 503 before any DB insert runs.

## Upload debug endpoint
`GET /api/upload/debug` (requires auth) — lists buckets, confirms bucket access, runs a tiny test upload. Use this to verify Supabase connectivity after any credential change.
