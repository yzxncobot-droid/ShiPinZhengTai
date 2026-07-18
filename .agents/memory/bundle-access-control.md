---
name: Bundle video access control
description: How bundle video privacy is enforced — DB field, API filter, and frontend gate
---

## The visibility field
`videos.visibility = 'hidden_bundle'` is the single source of truth for bundle exclusivity.
- `bundleExclusive = true` and `type = 'premium'` are legacy fields kept in sync via `syncBundleVideoVisibility()` in bundles.ts.

## Public API filter
All public video list endpoints (`GET /videos`, `GET /videos/featured`) apply:
```sql
WHERE visibility != 'hidden_bundle'
```
This covers: Home, Explore, Search (search uses /videos?search=), Trending, Premium.
Related videos endpoint returns 404 (no implementation), so bundle videos can't leak there.

## Bundle-by-video endpoint
`GET /api/bundles/video/:videoId` — returns the full bundle (with videos list + hasPurchased).
- Used by the watch page to determine if the user has access.
- Has UUID format guard (Postgres throws on non-UUID strings).

## Watch page access gate
`/bundle/watch/:videoId` checks `bundle.hasPurchased` before showing the player.
- If not purchased → shows AccessGate component linking to `/bundles/:bundleId`.
- If purchased → full player with title, likes, share, comments, "Video Dalam Paket Ini".
- NO creator/uploader info shown (bundle content is private).

## Admin upload bundle linking
When admin selects `hidden_bundle` content type + picks a bundle:
1. `POST /videos` creates video with `visibility = 'hidden_bundle'`
2. `PATCH /bundles/:bundleId` appends the new videoId to the bundle's videoIds
3. `syncBundleVideoVisibility()` in bundles.ts sets visibility/bundleExclusive on all linked videos

**Why:** Two-step because the video ID is only known after creation. The PATCH is safe — it fetches current videoIds and appends.
