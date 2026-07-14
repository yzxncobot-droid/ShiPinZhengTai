---
name: Demo-seeding empty dev DBs
description: Populating an empty dev database with realistic rows so a content-driven UI can be verified/demoed, without faking data in the UI layer.
---

When a freshly imported or newly built content platform (videos, products, plans, etc.) has an empty database, the real UI often looks broken even though the code is correct: infinite loading spinners waiting for data that will never arrive, empty grids, blank pricing/plan pages. This is easy to mistake for a rendering bug when it's actually just missing data.

**Why:** House rules prohibit mocked/fabricated data in the UI layer (fake discount fields, fake counts, etc.), but that's about not inventing fields the schema doesn't support — it doesn't mean the dev database must stay empty. Seeding real rows through the actual schema is legitimate and necessary to verify or showcase a data-driven UI.

**How to apply:**
- Write a small idempotent seed script (check counts / use `ON CONFLICT`/existence checks before inserting) so re-runs don't duplicate data.
- Run it with `pnpm --filter <db-package> exec node <script>.mjs` from the workspace root — this resolves the package's own `node_modules` correctly for ESM imports (plain `node script.mjs` at the repo root or with `NODE_PATH` tricks fails to resolve deps like `pg`/`bcrypt`).
- Avoid pulling in a hashing lib like `bcrypt` for seed-only accounts that are never used to log in for real — a placeholder-shaped string in the password hash column is fine and avoids a dependency-resolution detour.
- Use a reliable placeholder image host for thumbnails/avatars — `picsum.photos/seed/<name>/<w>/<h>` is stable; guessed Unsplash photo IDs frequently 404.
- Seed every collection the page actually renders (e.g. both `videos` and `subscriptions`/plans) — a page can look "broken" from just one empty adjacent table even if the main content loads.
