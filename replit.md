# Yzu视频 — Premium Video Platform

A full-featured premium video platform with browsing, uploading, subscriptions, pay-per-view bundles, leaderboards, and a wallet/referral system.

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19, Vite 7, Tailwind CSS 4, TanStack Query, Radix UI, Wouter |
| Backend | Node.js 20, Express 5, esbuild |
| Database | PostgreSQL (Replit managed) via Drizzle ORM |
| Storage | Supabase (video/image/payment files) — optional; uploads disabled without it |
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

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | ✅ Auto (Replit managed) | PostgreSQL connection string |
| `SESSION_SECRET` | ✅ Set | JWT signing secret |
| `SUPABASE_URL` | ⚠️ Optional | Supabase project URL — file uploads disabled without it |
| `SUPABASE_SERVICE_ROLE_KEY` | ⚠️ Optional | Supabase service key |
| `UPSTASH_REDIS_REST_URL` | ⚠️ Optional | Upstash Redis URL — sessions/caching disabled without it |
| `UPSTASH_REDIS_REST_TOKEN` | ⚠️ Optional | Upstash Redis token |

## Database

Schema is managed by Drizzle ORM. To push schema changes to the dev DB:

```bash
pnpm --filter @workspace/db run push
```

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
