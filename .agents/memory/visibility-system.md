---
name: Video visibility system
description: How the three-tier visibility model works (public/premium/hidden_bundle) and how it interacts with legacy type/bundleExclusive fields
---

## Rule
`videos.visibility` is the authoritative field. The legacy `type` (free|premium) and `bundleExclusive` columns are kept for API compat but are always derived from visibility on write.

## Values
- `public`        → free, appears in all listings, no auth required
- `premium`       → requires active subscription or individual purchase
- `hidden_bundle` → never appears in any listing (filtered in all GET /videos routes with `ne(visibility, "hidden_bundle")`); accessible only via bundle purchase (or individual purchase if priced)

## Sync helpers (lib/db/src/schema/videos.ts)
- `visibilityToLegacy(v)` → returns `{ type, bundleExclusive }`
- `legacyToVisibility(type, bundleExclusive)` → returns `VideoVisibility`
These are exported from `@workspace/db`.

## Backend rules
- `resolveVisibilityFields(body)` in routes/videos.ts normalises incoming data (accepts either `visibility` or legacy `type`+`bundleExclusive`)
- `checkAccess()` in routes/videos.ts handles all three values
- routes/bundles.ts: `syncBundleVideoVisibility(ids)` sets all bundle videos to `hidden_bundle`; `clearStaleBundleExclusive(ids)` resets videos no longer in any bundle to `premium`
- Admin override: `GET /videos?includeHidden=true` skips the hidden_bundle filter (staff only)

## Frontend
- Upload form (`admin/upload.tsx`) sends `visibility` to POST /videos via `adminFetch` (NOT the generated hook — avoids codegen dependency)
- Videos table (`admin/videos.tsx`) shows `VisibilityBadge` component; filter includes `hidden_bundle` option
- Bundles page (`admin/bundles.tsx`) is now accessible to both `admin` and `owner` (was owner-only)
- detail.tsx lock check: `visibility !== "public"` with legacy fallback for old cached data

**Why:** The original two-field model (type + bundleExclusive) was ambiguous and created filtering bugs. The visibility field is a single source of truth.
