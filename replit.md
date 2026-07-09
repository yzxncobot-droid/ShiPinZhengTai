# Yzu视频 (Yzu Video)

A premium video platform (browse, upload, subscribe/pay-per-view, leaderboard) with an Express API and a React web app.

## Run & Operate

- Workflows (already configured, start automatically): `artifacts/api-server: API Server`, `artifacts/yzu-video: web`, `artifacts/mockup-sandbox: Component Preview Server`
- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm --filter @workspace/yzu-video run dev` — run the web app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only) — required once after schema changes, tables were empty on import until this was run

## Required integrations / secrets

- `DATABASE_URL` — Postgres connection string, auto-provisioned by Replit's built-in database. Already set.
- `SESSION_SECRET` — used to sign JWTs (`artifacts/api-server/src/middlewares/auth.ts`). Already set.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` — the API server uses the Supabase JS client for file storage (video/thumbnail uploads, see `artifacts/api-server/src/lib/supabase.ts` and `routes/upload.ts`). You need your own Supabase project for this: create one at supabase.com, then grab the Project URL and the `service_role` key from Project Settings → API. These were requested and saved as secrets.
- No other third-party integrations are wired up yet (no payment provider is connected despite subscriptions/topups/transactions tables existing in the schema — if you want real payments, Stripe or Whop would need to be added).

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
