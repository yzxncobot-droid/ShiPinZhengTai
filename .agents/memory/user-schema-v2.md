---
name: Yzu视频 user schema v2
description: Key decisions from the Neon/username-auth migration — roles, auth flow, new tables, migration script location.
---

## Auth flow
- Registration: `username` + `password` only. `email` is optional (nullable, kept for legacy compat).
- Login: accepts `username` OR `email` in the `username` field (backward compat). 
- Default role for new users: `"meril"` (legacy `"user"` treated as equivalent; migration converts it).
- Referral code auto-generated (8 chars, `[A-Z2-9]`) on every registration; URL param `?ref=CODE` pre-fills the register form.

## Role hierarchy
`meril` (viewer) < `admin` (content) < `owner` (full access incl. payments & roles).
Legacy `"user"` value retained in DB enum so existing rows aren't broken.

## New tables added
- `wallets` — one row per user, mirrors `users.walletBalance` for audit; created idempotently on login + register.
- `wallet_transactions` — immutable double-entry ledger (positive = credit, negative = debit).
- `referrals` — one row per referral link (referrerId, referredId, codeUsed, status).
- `payment_proofs` — stores uploaded proof images separately from `topups`; `topups.paymentProofId` FK.

## Denormalised fields on users
`subscriptionStatus` (`none`/`active`/`expired`) and `subscriptionExpiry` (timestamp) — synced by:
- Login (checked every time)
- `POST /subscriptions/:id/purchase`
- `POST /users/:id/grant-subscription`
- Migration script

## Migration script
`lib/db/src/migrate.ts` — run via the pnpm pg path:
```
node -e "const pg = require('./node_modules/.pnpm/pg@8.22.0/node_modules/pg'); ..." 
```
from the workspace root (tsx is not installed in lib/db; use raw node + pg directly).
The script is idempotent: back-fills referral codes, converts "user"→"meril", creates wallet rows, syncs sub cache.

**Why:** The user spec required username-only auth, referral tracking, a separate wallet ledger, and payment proof records distinct from topup requests. The `email` column is kept nullable rather than dropped so any existing accounts with emails aren't broken.
