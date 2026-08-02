# Yzu视频 — Premium Video Platform

A full-featured premium video platform with browsing, uploading, subscriptions, pay-per-view bundles, leaderboards, and a wallet/referral system.

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19, Vite 7, Tailwind CSS 4, TanStack Query, Radix UI, Wouter |
| Backend | Node.js 20, Express 5, esbuild |
| Database | Neon PostgreSQL (external, via `NEON_DATABASE_URL`) via Drizzle ORM |
| Storage | Supabase Storage — single `yzx` bucket with role-based sub-folders |
| Sessions/Cache | Upstash Redis — optional; app runs without it (no session invalidation or caching) |
| Auth | JWT + username/password. Roles: `meril` (default user), `admin`, `owner` |

## Monorepo layout

```
artifacts/
  api-server/   Express backend (port 8080)
  yzu-video/    React frontend (port 21561, previewPath /)
  mockup-sandbox/ UI component preview server (port 8081)
lib/
  db/           Drizzle schema + migrations
  api-spec/     OpenAPI spec (source of truth)
  api-client-react/ Generated TanStack Query hooks
  api-zod/      Generated Zod schemas
scripts/        Utility/migration scripts
```

## How to run

Both services start automatically via their configured workflows:

- **API Server** — `artifacts/api-server: API Server`
- **Frontend** — `artifacts/yzu-video: web`

## Environment variables

### Core (always required)

| Variable | Required | Purpose |
|----------|----------|---------|
| `NEON_DATABASE_URL` | ✅ Set (Secret) | Primary PostgreSQL connection string (external Neon DB with existing data) |
| `SESSION_SECRET` | ✅ Set (Secret) | JWT signing secret |
| `DATABASE_URL` | Fallback only | Replit-managed PostgreSQL — NOT used; `NEON_DATABASE_URL` takes priority |

### Legacy Supabase (single-project — bundle videos, images, Owner thumbnails)

| Variable | Required | Purpose |
|----------|----------|---------|
| `SUPABASE_URL` | ⚠️ Optional | Legacy Supabase project URL — bundle/image/Owner-thumbnail uploads disabled without it |
| `SUPABASE_SERVICE_ROLE_KEY` | ⚠️ Optional | Legacy Supabase service key |

### Creator Storage (Supabase Project 1)

| Variable | Required | Purpose |
|----------|----------|---------|
| `CREATOR_SUPABASE_URL` | ⚠️ Optional | Creator Supabase project URL — Creator uploads disabled without it |
| `CREATOR_SUPABASE_SERVICE_ROLE_KEY` | ⚠️ Optional | Creator Supabase service key |

### Verified Creator Storage (Supabase Project 2)

| Variable | Required | Purpose |
|----------|----------|---------|
| `VERIFIED_CREATOR_SUPABASE_URL` | ⚠️ Optional | Verified Creator Supabase project URL |
| `VERIFIED_CREATOR_SUPABASE_SERVICE_ROLE_KEY` | ⚠️ Optional | Verified Creator Supabase service key |

### Owner Storage (Bunny Stream)

| Variable | Required | Purpose |
|----------|----------|---------|
| `BUNNY_STREAM_LIBRARY_ID` | ⚠️ Optional | Bunny Stream library ID — Owner video uploads disabled without it |
| `BUNNY_STREAM_API_KEY` | ⚠️ Optional | Bunny Stream API key (AccessKey) |
| `BUNNY_CDN_HOSTNAME` | Optional | Pull-zone hostname (e.g. `vz-abc.b-cdn.net`). If not set, embed URL is used as `videoUrl`. |

### Redis (caching/sessions)

| Variable | Required | Purpose |
|----------|----------|---------|
| `UPSTASH_REDIS_REST_URL` | ⚠️ Optional | Upstash Redis URL — sessions/caching disabled without it |
| `UPSTASH_REDIS_REST_TOKEN` | ⚠️ Optional | Upstash Redis token |

> **Database note:** This project connects to an **external database** via `NEON_DATABASE_URL` to preserve existing data.
> The Replit-managed `DATABASE_URL` is intentionally not used. Connection string is set as a Replit Secret.
> See `lib/db/src/index.ts` — it prefers `NEON_DATABASE_URL ?? DATABASE_URL`.

## Database

Schema is managed by Drizzle ORM. To push schema changes to the dev DB:

```bash
pnpm --filter @workspace/db run push
```

## Video Storage Architecture

All files live in the single `yzx` Supabase bucket. New uploads use **role-based sub-folders** based on the selected Uploader Type in the admin upload form:

| Uploader Type    | Videos folder               | Thumbnails folder               |
|------------------|-----------------------------|---------------------------------|
| Creator          | `creator/videos/`           | `creator/thumbnails/`           |
| Verified Creator | `verified-creator/videos/`  | `verified-creator/thumbnails/`  |
| Owner            | `owner/videos/`             | `owner/thumbnails/`             |

Payment proofs always go to `verified-creator/payments/` regardless of uploader type.

**Backward compatibility:** existing files in legacy folders (`videos/`, `thumnails/`, `payments/`, `bundles/`, `bundle-thumbnails/`) continue to work — nothing was deleted or moved.

**DB metadata:** each video record now stores `uploader_type`, `thumbnail_path`, `storage_folder`, and `bucket_name` (all nullable for existing videos).

## API codegen

When the OpenAPI spec (`lib/api-spec/openapi.yaml`) changes, regenerate the client:

```bash
pnpm --filter @workspace/api-spec run codegen
```

## User roles

- New signups default to role `meril` (regular user)
- To grant admin/owner access, an existing owner must update the role in the database
- `admin` can upload videos; `owner` has full access

## User preferences

- Keep the project's existing structure and stack; do not restructure or migrate
