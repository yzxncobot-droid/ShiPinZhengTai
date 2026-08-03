import app from "./app";
import { logger } from "./lib/logger";
import {
  runCriticalStartupMigration,
  runBestEffortStartupMigration,
} from "./lib/startup-migration";

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
});
