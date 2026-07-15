---
name: No self-serve role promotion (Yzu视频)
description: Why a real user hits "forbidden" on admin/upload actions and how to fix it.
---

New registrations always default to role `user`; the only way to become `admin`/`owner` is an existing owner calling `PATCH /users/:id/role`. There is no self-service upgrade path.

**Why:** Upload endpoints themselves only require `authenticate`, but publishing (`POST /videos`) and most `/admin/*` frontend routes are gated with `requireRole("admin","owner")` / `ProtectedRoute`. A real tester's account created via normal signup will look "forbidden" everywhere in the admin panel even though nothing is actually broken.

**How to apply:** When a user reports "forbidden" on admin/upload/publish actions, check their DB role first. If they're on `user`, promote the intended real account directly via SQL (`update users set role='owner' where email=...`) rather than debugging the upload code — confirm the specific email/account with the user before promoting.
