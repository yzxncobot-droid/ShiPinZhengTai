---
name: API server startup fragility pattern
description: KV and Supabase both throw at module import time when env vars are missing; fix is graceful no-op, not hard crash.
---

## Rule
Never let infrastructure clients throw at module-level (top-level) when environment variables are absent. The entire Express process crashes before it can handle a single request.

## What crashed
- `redis.ts` — threw `Error("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set")` at top-level scope before the server even started.
- `supabase.ts` — threw `Error("SUPABASE_URL environment variable is required")` at top-level scope.

## Fix applied
Both modules now degrade gracefully:
- `redis.ts`: exports `isRedisAvailable` flag; if false, uses a no-op stub (`get→null, setex→OK, del→0, incr→1`). The real client is Layerbase Valkey (`layerbase-kv.ts`, using `@upstash/redis`), instantiated synchronously when `KV_REST_API_URL` / `KV_REST_API_TOKEN` are present.
- `supabase.ts`: exports `isSupabaseAvailable` flag; `createClient()` called with placeholder strings when credentials absent (doesn't throw — only fails on actual API calls). `uploadWithRetry()` checks `isSupabaseAvailable` first and throws a clear user-facing error.
- `auth.ts` middleware: session-store check (`getSession`) is now skipped entirely when `isRedisAvailable` is false — prevents every request being 401 denied because KV returns null for everything.

## Why
Layerbase Valkey and Supabase are optional in local/dev environments. The rest of the app (DB reads/writes, auth via JWT, all CRUD routes) must work without them. Uploads and session invalidation are the only features that require them.

**How to apply:** Any new infrastructure client (queue, cache, storage, search) must follow the same pattern — check env vars, export an availability flag, use a no-op or skip when absent, never throw at import time.
