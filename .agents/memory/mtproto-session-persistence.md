---
name: MTProto session persistence and log safety
description: Safely persist GramJS sessions, isolate runtime auth keys, and prevent them from leaking through database logs.
---

## Rule
Pass the serialized `StringSession` value directly to persistence. Do not wrap the serialized string in a new `StringSession` and call `save()` again unless that new session has first been loaded. Keep database bind parameters and session-write errors out of logs. Do not share one persisted Telegram auth key between development and production runtimes.

**Why:** Re-wrapping a serialized session without loading it produced an empty string, so the bot authenticated again on every restart. Development SQL logging also printed bound values, which could expose a valid session string once persistence was corrected. Sharing an auth key between runtimes can make Telegram reject startup with `AUTH_KEY_DUPLICATED`.

**How to apply:** Namespace persistent database and file sessions by runtime environment when development and production share storage. Keep existing sessions intact when introducing the namespaces. Verify the session is non-empty and restart the API once to confirm it loads as authorized. Check logs for absence of the session value.
## Environment isolation
Do not run development and production MTProto clients against the same persisted bot session at the same time. Telegram can reject the reused auth key with `AUTH_KEY_DUPLICATED`; use environment-specific session storage or an isolated test bot/session for live verification.

**Why:** A development startup loaded the persisted Neon session while another service was using it, and Telegram rejected MTProto initialization as a duplicate auth key.

**How to apply:** Before restarting a development API that has Telegram credentials, confirm it cannot load the production session from shared storage. Do not force a fresh session into shared storage while another service may be active.
