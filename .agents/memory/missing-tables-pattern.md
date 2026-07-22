---
name: Missing tables pattern
description: Drops tables and other schema objects were entirely absent from the live Neon DB; same root cause as the chat_rooms missing columns bug.
---

## Rule
Before treating a Drizzle "Failed query: UPDATE/INSERT…" error as a code bug, always verify the table and its columns exist in the live DB:

```sql
SELECT column_name FROM information_schema.columns WHERE table_name = '<table>' ORDER BY ordinal_position;
```

An empty result means the table doesn't exist at all.

## Tables confirmed missing and fixed (same session)
- `chat_rooms` — columns `category`, `is_pinned_group`, `is_public`, `sort_order`, `member_limit`, `is_locked`, `slow_mode_seconds` were absent → added via ALTER TABLE.
- `drops`, `drop_claims`, `drop_logs` — tables entirely absent → created via raw SQL including the `drop_status` enum.

**Why:** The Neon DB was migrated from an older version of the project that predated these schema additions. Drizzle-kit `push` was never run against it. Drizzle ORM surfaces the PG error inside `err.cause` but the outer error message shows the raw query text — this masked the real cause.

**How to apply:** Any new "Failed query" 500 on a route that wasn't recently changed → check `information_schema.columns` for the table before reading route code.
