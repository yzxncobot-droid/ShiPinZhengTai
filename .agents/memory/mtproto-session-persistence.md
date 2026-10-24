---
name: MTProto session persistence and log safety
description: Safely persist GramJS sessions and prevent their auth key from leaking through database logs.
---

## Rule
Pass the serialized `StringSession` value directly to persistence. Do not wrap the serialized string in a new `StringSession` and call `save()` again unless that new session has first been loaded. Keep database bind parameters and session-write errors out of logs.

**Why:** Re-wrapping a serialized session without loading it produced an empty string, so the bot authenticated again on every restart. Development SQL logging also printed bound values, which could expose a valid session string once persistence was corrected.

**How to apply:** When changing GramJS authentication or persistence, verify the Neon row contains a non-empty session and restart the API once to confirm it loads as already authorized. Check logs for absence of the session value.
