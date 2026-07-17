# Yzu视频 (Yzu Video)

A premium video platform (browse, upload, subscribe/pay-per-view, leaderboard) with an Express API and a React web app.

## Run & Operate

Three artifact-managed workflows run automatically:

| Workflow | Command | Port |
|---|---|---|
| `artifacts/api-server: API Server` | `pnpm --filter @workspace/api-server run dev` | 8080 |
| `artifacts/yzu-video: web` | `pnpm --filter @workspace/yzu-video run dev` | auto |
| `artifacts/mockup-sandbox: Component Preview Server` | `pnpm --filter @workspace/mockup-sandbox run dev` | auto |

Other useful commands:
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only); run once after a fresh clone or schema change

## Required secrets

| Secret | Description |
|---|---|
| `SESSION_SECRET` | Signs JWTs (`artifacts/api-server/src/middlewares/auth.ts`) |
| `JWT_SECRET` | JWT verification secret |
| `SUPABASE_URL` | Supabase project URL (e.g. `https://xxxx.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key — Supabase → Project Settings → API |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL (from Upstash console) |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token |
| `DATABASE_URL` | Replit built-in PostgreSQL — provided automatically; do not set manually |

Feature-flag env vars (all default to `true`): `ENABLE_WALLET`, `ENABLE_SUBSCRIPTIONS`, `ENABLE_BUNDLES`, `ENABLE_REFERRALS`, `ENABLE_MANUAL_QRIS`.

Storage bucket env vars (all default to `yzx`): `SUPABASE_VIDEOS_BUCKET`, `SUPABASE_THUMBNAILS_BUCKET`, `SUPABASE_PAYMENTS_BUCKET`.

## Stack

- pnpm workspaces, Node.js 20 (with `ws` polyfill for Supabase realtime), TypeScript 5.9
- API: Express 5, esbuild bundle
- DB: **Replit built-in PostgreSQL** + Drizzle ORM (schema pushed via `drizzle-kit push`)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- Frontend: React 19, Vite 7, Tailwind CSS 4, Radix UI, TanStack Query, Wouter
- API codegen: Orval (from OpenAPI spec in `lib/api-spec`)
- File storage: Supabase Storage (videos, thumbnails, images, payment proofs)
- Sessions/cache: Upstash Redis

## Where things live

| Area | Path |
|---|---|
| DB schema | `lib/db/src/schema/index.ts` |
| API spec (OpenAPI) | `lib/api-spec/` |
| Generated API hooks | `lib/api-client-react/src/` |
| API routes | `artifacts/api-server/src/routes/` |
| Supabase client + storage | `artifacts/api-server/src/lib/supabase.ts` |
| Frontend pages | `artifacts/yzu-video/src/pages/` |
| Frontend components | `artifacts/yzu-video/src/components/` |

## Gotchas

- **`ws` polyfill required on Node 20** — `@supabase/realtime-js` needs WebSocket. The `ws` npm package is imported and polyfilled in `artifacts/api-server/src/lib/supabase.ts` to work around this on Node.js 20.
- **DATABASE_URL is Replit's built-in PostgreSQL** — do not manually set it; Replit injects it automatically.
- **Run `pnpm --filter @workspace/db run push` after a fresh clone** — tables start empty; run this once to create the schema.
- **New users default to role `meril`** — to access admin/upload features, an owner must promote the account via the admin panel.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._
