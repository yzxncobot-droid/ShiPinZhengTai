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

### Unified Supabase Project

| Variable | Required | Purpose |
|----------|----------|---------|
| `SUPABASE_URL` | ✅ Required | Unified Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ Required | Unified Supabase service_role key |

### Redis (caching/sessions)

| Variable | Required | Purpose |
|----------|----------|---------|
| `KV_REST_API_URL` | — | Removed. Sessions/caching now use in-memory TTL cache (no external service). |
| `KV_REST_API_TOKEN` | — | Removed. No longer needed. |

> **Database note:** This project connects to an **external database** via `NEON_DATABASE_URL` to preserve existing data.
> The Replit-managed `DATABASE_URL` is intentionally not used. Connection string is set as a Replit Secret.
> See `lib/db/src/index.ts` — it prefers `NEON_DATABASE_URL ?? DATABASE_URL`.

### Automatic QRIS (BuatQris)

| Variable | Required | Purpose |
|----------|----------|---------|
| `BUATQRIS_ACCOUNT_ID` | ✅ Set (Secret) | Backend-only BuatQris Account ID for QRIS creation and status checks |
| `BUATQRIS_SECRET_TOKEN` | ✅ Set (Secret) | Backend-only BuatQris Secret Token (never sent to frontend) |
| `BUATQRIS_WEBHOOK_SECRET` | ✅ Set (Secret) | Secret used to verify BuatQris webhook signatures (X-BuatQris-Signature) |
| `PUBLIC_BASE_URL` | Optional | Public app URL used for the webhook callback URL; falls back to `BASE44_PUBLIC_HOST_SUFFIX` |

The application creates a BuatQris dynamic QRIS through `POST /api/payments/buatqris/create`.
The customer scans and pays, then presses **Sudah Bayar**. The backend checks the
BuatQris transaction status through `POST /api/topup/:id/confirm-paid`; it never credits
the wallet from the button click alone. BuatQris sends the signed `payment.success`
callback to `POST /api/webhooks/buatqris`. Only that verified event (or a successful
provider status check) credits the wallet via `creditVerifiedTopup()` inside an
idempotent database transaction with a PostgreSQL advisory lock.

## Database

Schema is managed by Drizzle ORM. To push schema changes to the dev DB:

```bash
pnpm --filter @workspace/db run push
```

## Video Storage Architecture

A single unified Supabase project handles all file storage:

### Unified Supabase Project (`SUPABASE_URL`)
Used for all Creator, Verified Creator, Owner, Admin, and media uploads.

| Uploader Type    | Videos folder                        | Thumbnails folder                        |
|------------------|--------------------------------------|------------------------------------------|
| Creator          | `yzx/videos/creator/` or `yzx/videos/{userId}/` | `yzx/thumbnails/` or `yzx/thumbnails/{userId}/` |
| Verified Creator | `yzx/videos/verified-creator/`       | `yzx/thumbnails/`                        |
| Owner / Admin    | `yzx/videos/owner/` or `yzx/owner/videos/` | `yzx/thumbnails/` or `yzx/owner/thumbnails/` |

Payment proofs: `yzx/payments/` or `yzx/verified-creator/payments/{userId}/`

### Routing logic
- All uploads use the centralized `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- Role-based permissions determine upload rights and target storage paths.
- Legacy rows (pre-migration) with no `storage_type` are back-filled on startup.

**Backward compatibility:** existing files in legacy folders continue to work — nothing was deleted or moved. The startup migration in `artifacts/api-server/src/lib/startup-migration.ts` back-fills `storage_type` from `uploader_type` on every boot.

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
