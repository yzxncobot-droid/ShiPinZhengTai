---
name: Yzu视频 JWT secret
description: JWT signing secret configuration — must not have a fallback
---

## Rule
`artifacts/api-server/src/middlewares/auth.ts` reads `SESSION_SECRET` from env and throws at startup if absent. There must be no hardcoded fallback secret.

**Why:** A known fallback secret lets anyone forge valid tokens. `SESSION_SECRET` is already provisioned as a Replit secret.

**How to apply:** Any future change to auth middleware must keep the startup check: `if (!JWT_SECRET) { throw new Error("SESSION_SECRET environment variable is required"); }`
