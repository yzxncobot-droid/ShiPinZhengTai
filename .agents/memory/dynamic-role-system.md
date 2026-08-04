---
name: Dynamic role system (custom_role_id on users)
description: How the custom role assignment works in the Users admin page — custom_roles table is the source of truth for display roles.
---

## The two-layer role system

1. **System role** (`users.role` enum) — controls auth middleware, admin panel access, upload permissions. Values: `meril`, `creator`, `verified_creator`, `moderator`, `admin`, `owner`. Changed via `PATCH /users/:id/role`.

2. **Custom role** (`users.custom_role_id` FK → `custom_roles.id`) — cosmetic display role with emoji, color, and feature permissions. Changed via `PATCH /users/:id/custom-role`. Created/managed in Badge & Role Management page.

## Schema

`users.custom_role_id` is a nullable UUID column added via startup migration (best-effort):
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_role_id uuid REFERENCES custom_roles(id) ON DELETE SET NULL;
```
No Drizzle-level FK reference (avoids circular import: users.ts ← custom-roles.ts ← users.ts). The FK lives only in the DB.

## Backend endpoints

- `GET /users` — left-joins `custom_roles` on `custom_role_id`; returns `customRole: { id, name, emoji, color }` per user. Supports `?customRoleId=<uuid>` filter param.
- `PATCH /users/:id/custom-role` — sets `customRoleId` (owner only). Pass `{ customRoleId: null }` to clear.
- `DELETE /admin/badge-roles/:id` — null-outs affected users manually before deleting role; returns `{ ok, affectedUsers }`.

## Frontend (Users admin page)

- No hardcoded role lists or ROLE_COLORS.
- Fetches active custom roles from `/admin/badge-roles`, filtered by `isActive`.
- Role badge: shows custom role (emoji + name + dynamic color) when set; falls back to system role string.
- Filter dropdown: lists active custom roles from DB.
- "Ubah Role" dialog: loads custom roles, pre-selects current, calls `PATCH /users/:id/custom-role`.
- Toast "Role berhasil diperbarui." on success, closes modal.

**Why:** `users.role` must stay for auth middleware (requireRole). `custom_role_id` is the display/badge role. Keeping them separate means auth never breaks when custom roles change.

**How to apply:** When building any feature that assigns or displays roles:
- For access control → check `users.role` (system)
- For display/badges → read `users.custom_role_id` → join `custom_roles`
