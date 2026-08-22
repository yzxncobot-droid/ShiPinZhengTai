import app from "./app";
import { logger } from "./lib/logger";
import {
  runCriticalStartupMigration,
  runBestEffortStartupMigration,
} from "./lib/startup-migration";
import { ensureStorageBuckets } from "./lib/storage/setup";
import { sweepStalePendingTopups, settlePaidTopups } from "./routes/topups";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// ── Critical financial schema migration must succeed BEFORE accepting traffic ─
// If revenue_shares or payout_status enum cannot be created/verified, the
// server exits immediately rather than serving purchases without a ledger.
try {
  await runCriticalStartupMigration();
} catch (err) {
  logger.error({ err }, "Critical startup migration failed — refusing to start");
  process.exit(1);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Best-effort: adds columns, back-fills, etc. Failures are warnings only.
  runBestEffortStartupMigration().catch((e) =>
    logger.warn({ err: e?.message }, "startup-migration: unexpected error"),
  );

  // Best-effort: validate service_role keys and auto-create the `yzx` bucket
  // in every configured Supabase project (PUBLIC / OWNER / MEDIA).
  // A missing bucket is the most common cause of "violates row-level security"
  // errors on fresh Supabase projects — service_role bypasses RLS for objects
  // once the bucket exists.
  ensureStorageBuckets().catch((e) =>
    logger.warn({ err: e?.message }, "Storage bucket setup: unexpected error"),
  );

  // Best-effort: cancel any pending (menunggu) QRIS top-ups older than 5 min so
  // no payment lingers in "menunggu" across restarts.
  sweepStalePendingTopups().catch((e) =>
    logger.warn({ err: (e as any)?.message }, "topup: startup stale sweep failed"),
  );

  // Full-automatic top-up: poll TemanQRIS for paid orders every 30s and credit
  // the wallet with no merchant action. Best-effort — gateway errors are logged.
  settlePaidTopups().catch((e) =>
    logger.warn({ err: (e as any)?.message }, "topup: startup auto-settle failed"),
  );
  setInterval(() => {
    settlePaidTopups().catch((e) =>
      logger.warn({ err: (e as any)?.message }, "topup: auto-settle sweep failed"),
    );
  }, 30_000);
});
