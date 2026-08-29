# Layerbase Heartbeat

Sistem heartbeat untuk mencegah Layerbase Valkey (Free tier) menjadi idle/hibernate
dengan melakukan request ringan secara berkala menggunakan **external cron job**.

> **Penting:** Heartbeat membantu mencegah database menjadi idle dengan melakukan
> request secara berkala, tetapi **bukan pengganti fitur Always-on resmi dari
> Layerbase**. Heartbeat tidak menjamin database tidak pernah hibernate.

---

## Endpoint

```
GET /api/health/layerbase
```

Melakukan satu write ringan ke key `__system:layerbase:heartbeat` dengan TTL
600 detik (10 menit).

### Header (wajib)

Pilih salah satu:

```
Authorization: Bearer YOUR_CRON_HEARTBEAT_SECRET
```

atau

```
X-Cron-Secret: YOUR_CRON_HEARTBEAT_SECRET
```

### Response

| Kondisi | HTTP | Body |
|---|---|---|
| Secret valid, heartbeat berhasil | 200 | `{ "ok": true }` |
| Secret valid, heartbeat gagal | 503 | `{ "ok": false }` |
| Secret tidak ada / salah | 401 | `{ "error": "Unauthorized" }` |

Response **tidak pernah** mengandung token, URL, atau detail error internal.

---

## Status Endpoint

```
GET /api/health/layerbase/status
```

Juga dilindungi oleh `CRON_HEARTBEAT_SECRET`. Mengembalikan informasi aman:

```json
{
  "ok": true,
  "lastHeartbeat": "2026-08-29T04:38:00.000Z",
  "latencyMs": 42
}
```

---

## Konsep: 5 menit heartbeat + 10 menit TTL

- **Heartbeat interval:** setiap 5 menit (`*/5 * * * *`)
- **TTL key:** 600 detik (10 menit)

Margin 5 menit memberikan toleransi apabila cron terlambat atau melewatkan
satu cycle — key masih ada sampai cycle berikutnya.

---

## Environment Variables

| Variable | Wajib? | Keterangan |
|---|---|---|
| `KV_REST_API_URL` | Ya (untuk heartbeat) | URL Layerbase Valkey REST API |
| `KV_REST_API_TOKEN` | Ya (untuk heartbeat) | Token Layerbase (server-only, **jangan** masukkan ke cron-job.org) |
| `CRON_HEARTBEAT_SECRET` | Ya | Secret untuk melindungi endpoint heartbeat |

### Setup di Replit Secrets

1. Buka tab **Secrets** di Replit.
2. Tambahkan:
   - `CRON_HEARTBEAT_SECRET` = `<random-long-secret>`
3. Pastikan `KV_REST_API_URL` dan `KV_REST_API_TOKEN` juga sudah ada di Secrets.

### Generate secret yang aman

Gunakan random string yang cukup panjang, contoh:

```bash
openssl rand -hex 32
```

**Jangan gunakan** nilai seperti `password`, `123456`, `heartbeat`, `layerbase`,
atau `secret` sebagai secret production.

---

## Setup Cron di cron-job.org

1. Buka [cron-job.org](https://cron-job.org) dan login.
2. Klik **Create Cronjob**.
3. Isi:
   - **Title:** `Layerbase Heartbeat`
   - **URL:** `https://DOMAIN_WEBSITE/api/health/layerbase`
   - **Execution schedule:** `Every 5 minutes` (atau cron expression `*/5 * * * *`)
   - **Request method:** `GET`
4. Pada **Headers**, tambahkan:
   ```
   Authorization: Bearer YOUR_CRON_HEARTBEAT_SECRET
   ```
5. Simpan.

> **Anda hanya perlu memasukkan `CRON_HEARTBEAT_SECRET` ke cron-job.org.**
> JANGAN pernah memasukkan `KV_REST_API_TOKEN` atau `KV_REST_API_URL` ke
> cron-job.org.

### Retry

Jika request gagal (HTTP 503 atau timeout), cron-job.org akan mencoba lagi
pada cycle berikutnya. Tidak ada retry loop di server — server hanya
mencatat kegagalan dan mengembalikan 503.

---

## Logging

Server mencatat hasil heartbeat dengan prefix `[LAYERBASE_HEARTBEAT]`:

```
[LAYERBASE_HEARTBEAT] success duration=123ms
[LAYERBASE_HEARTBEAT] failed duration=5000ms
```

Tidak ada credential yang dicatat di log.

---

## File yang terkait

| File | Keterangan |
|---|---|
| `artifacts/api-server/src/services/layerbaseHeartbeat.ts` | Service heartbeat (write + status) |
| `artifacts/api-server/src/routes/layerbase-heartbeat.ts` | Endpoint route + auth |
| `artifacts/api-server/src/services/layerbaseHeartbeat.test.ts` | Unit tests |
| `docs/layerbase-heartbeat.md` | Dokumentasi ini |
