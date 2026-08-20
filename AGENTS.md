# Base44 dev environment — Yzu Video

## Stack
- **Monorepo** (pnpm workspace): `artifacts/api-server` (Express backend), `artifacts/yzu-video` (Vite/React frontend), `lib/*` (shared db, api client, zod, spec).
- **Frontend** React 19 + Vite 7, Tailwind 4, TanStack Query, Wouter. Dev server on internal port **21561**, mapped to host **3000**.
- **Backend** Express 5, bundled with esbuild, runs on port **8080**. `dev` script builds once then starts (no watch) — restart the `api` service after backend edits.
- **DB** external Neon Postgres via `NEON_DATABASE_URL` (Drizzle ORM). `lib/db/src/index.ts` falls back to `DATABASE_URL` but always enables SSL (`rejectUnauthorized: false`) — a local non-SSL Postgres won't work without code changes; use Neon.
- **Storage** three Supabase projects (PUBLIC/OWNER/MEDIA), each with a `yzx` bucket the server auto-creates on boot.
- **Redis** Upstash, optional (sessions/cache disabled without it).

## Running
```
docker compose -f docker-compose.base44.yml up -d --build
docker compose -f docker-compose.base44.yml logs -f web api
```
- A one-shot `install` service runs `pnpm install` at the workspace root; `api` and `web` depend on it completing successfully.
- Frontend uses **relative `/api/...` calls only** (no base URL set in the React client). Vite proxies `/api` → `${API_URL}` (set to `http://api:8080` in compose) so cookies/auth stay single-origin. The proxy is added conditionally only when `API_URL` is set, so the original Replit setup is unaffected.
- Required env at boot: `PORT` (api=8080, web=21561), `BASE_PATH=/` (web), `SESSION_SECRET` (JWT signing). A dev placeholder for `SESSION_SECRET` lives in `.env.base44-defaults` until you set the real one.

## Secrets (delivered to /run/base44/app.env, loaded last in compose)
- `NEON_DATABASE_URL` — required, existing Neon DB with data.
- `SESSION_SECRET` — required (dev placeholder provided).
- `PUBLIC_SUPABASE_URL` / `PUBLIC_SUPABASE_SERVICE_KEY`, `OWNER_SUPABASE_*`, `MEDIA_SUPABASE_*` — video/avatar storage.
- `TEMANQRIS_API_KEY` / `TEMANQRIS_WEBHOOK_SECRET` — wallet top-up only.
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` — optional caching.

## Verifying it works
- `curl -sf -H "Host: external-preview.example.com" http://localhost:3000/` returns the React app.
- `curl -sf http://localhost:3000/api/system/health` (or whatever health route exists) reaches the API through the Vite proxy.
- Check `docker compose ps` — `web` and `api` should be `Up`. The `install` service exits 0.

## Notes / quirks
- `pnpm-workspace.yaml` enforces a 1-day `minimumReleaseAge` on npm packages (supply-chain defense). Network/time must be healthy for install.
- Backend dev command builds once (`esbuild` bundle into `artifacts/api-server/dist`) then runs — **no file watch**. After editing backend TS, restart the api service: `docker compose -f docker-compose.base44.yml restart api` (then `reload_preview`).
- Frontend dev server is Vite with hot reload (watch polling may be needed on bind mounts); it already sets `host: 0.0.0.0` and `allowedHosts: true`.
- The mockup-sandbox (`artifacts/mockup-sandbox`) is a component-preview tool; not wired into the base44 compose (not needed for the main app).
