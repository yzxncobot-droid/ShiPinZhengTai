---
name: Supabase storage layout
description: Single yzx bucket structure after consolidating payment proofs from a separate payments bucket
---

## Rule
One bucket: `yzx`. All media lives here with sub-folder paths.

| Sub-folder    | Usage |
|---------------|-------|
| `videos/`     | uploaded video files |
| `thumnails/`  | video thumbnails (folder name is intentionally misspelled to match existing bucket paths) |
| `images/`     | generic images — avatars, logos, banners, QRIS |
| `payments/`   | payment proof screenshots (`payments/{userId}/{timestamp}-{random}.ext`) |

## Constants (lib/supabase.ts)
- `MEDIA_BUCKET = "yzx"` — primary constant, use this everywhere
- `PAYMENT_BUCKET = MEDIA_BUCKET` — deprecated alias, kept for call-sites not yet updated
- `PAYMENTS_FOLDER = "payments"` — sub-folder for payment proofs

## Retry
`uploadWithRetry(bucket, path, buffer, contentType, opts)` retries 3× with 500 ms / 1 s / 2 s back-off. Use it for all new upload code instead of raw `supabase.storage.from(bucket).upload()`.

**Why:** Originally payment proofs used a separate `payments` bucket; consolidated into yzx to simplify policy management and reduce bucket count.
