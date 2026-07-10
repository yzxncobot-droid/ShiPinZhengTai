---
name: Admin panel white-screen guards
description: Root causes found for blank/white admin pages on mobile and the defensive fixes applied
---

- ProtectedRoute previously only checked token presence, never waited for the `/api/auth/me` profile fetch nor enforced `allowedRoles` — pages could render with `user` still `null` and role-restricted UI could crash or render inconsistently before the profile loaded.
- No top-level ErrorBoundary existed anywhere in the app — any render-time exception in a route (bad data shape, unhandled query error) had no boundary to catch it, so React unmounts the tree and the browser shows a blank white page with only a console error, which is invisible to a user unless they open devtools.

**Why:** admin data tables used `?? []` fallbacks on query data, which silently hides fetch failures instead of surfacing them — combined with no ErrorBoundary, any unexpected error state (network failure, malformed response, unmounted-role edge case) had no visible failure mode other than a blank page.

**How to apply:** keep a top-level `ErrorBoundary` wrapping the router (`yzu-video/src/App.tsx`) so future page crashes show a retry UI instead of white screen; keep `ProtectedRoute` waiting on auth `isLoading` before deciding access and enforcing `allowedRoles` with a visible "no access" message; give admin data tables an explicit `isError` branch (message + retry button) rather than only a loading/empty state.
