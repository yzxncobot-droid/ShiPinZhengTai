---
name: Auth profile fetch resilience
description: Client behavior when the authenticated profile request fails after login
---

## Rule
Treat `/auth/me` network, API restart, and temporary database failures as recoverable. Clear the stored JWT only when the server explicitly returns an authentication/authorization failure (401 or 403).

**Why:** The profile request runs immediately after login and can briefly fail while the API or database is restarting. Clearing the token for every error makes a successful sign-in appear to log the user out.

**How to apply:** Keep retry enabled for non-authentication errors and gate client-side logout on the response status, while preserving immediate invalidation for expired, revoked, deleted, or banned accounts.