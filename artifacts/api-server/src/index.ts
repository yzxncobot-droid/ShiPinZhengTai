import app from "./app";
import { logger } from "./lib/logger";
import {
  runCriticalStartupMigration,
  runBestEffortStartupMigration,
} from "./lib/startup-migration";
import { ensureStorageBuckets } from "./lib/storage/setup";
import { pool } from "@workspace/db";

// ── Environment validation ───────────────────────────────────────────────────
const rawPort = process.env["PORT"];

if (!rawPort) {
  logger.error("[MISSING ENV] PORT — the platform must provide the port to listen on");
  process.exit(1);
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  logger.error({ rawPort }, "Invalid PORT value");
  process.exit(1);
}

// ── Readiness flag (read by GET /api/readyz) ──────────────────────────────────
// Set to true only after DB init + critical migration succeed.
app.set("isReady", false);

// ── Process-level error handlers ─────────────────────────────────────────────
// Log safely (no secrets) and keep running when possible. A genuine uncaught
// exception still exits so the platform can restart us in a clean state.
process.on("unhandledRejection", (reason) => {
  logger.error(
    { err: reason instanceof Error ? reason.message : String(reason) },
    "Unhandled promise rejection",
  );
});

process.on("uncaughtException", (err) => {
  logger.error({ err: err.message, stack: err.stack }, "Uncaught exception — shutting down");
  process.exit(1);
});

// ── Start listening FIRST so the port is open for health checks ───────────────
// The platform's port probe (expected=[8080]) succeeds immediately. Database
// initialisation and migrations run *after* listen so a slow or temporarily
// unreachable DB does NOT cause a "port never opened" timeout.
logger.info("[SERVER] Starting...");
logger.info("[SERVER] Host: 0.0.0.0");
logger.info(`[SERVER] Port: ${port}`);

const server = app.listen(port, "0.0.0.0", (err) => {
  if (err) {
    logger.error({ err: err.message }, "[SERVER] Failed to listen");
    process.exit(1);
  }
  logger.info(`[SERVER] Server listening on 0.0.0.0:${port}`);
});

// ── Database initialisation + migrations (bounded retry) ────────────────────
// Runs after the server is already accepting connections. GET /api and
// GET /api/healthz return 200 immediately (liveness). GET /api/readyz returns
// 503 until this completes successfully, then 200 (readiness).
async function initDatabase(): Promise<void> {
  logger.info("[SERVER] Database initialization...");

  const maxRetries = 3;
  const retryDelayMs = 3_000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let client;
    try {
      // ── Test the connection ──
      client = await pool.connect();
      await client.query("SELECT 1");
      client.release();
      client = undefined;
      logger.info("[SERVER] Database ready");

      // ── Critical financial schema migration (must succeed) ──
      logger.info("[MIGRATION] Starting: critical financial schema");
      await runCriticalStartupMigration();
      logger.info("[MIGRATION] Success: critical financial schema");

      // ── Best-effort schema tweaks ──
      logger.info("[MIGRATION] Starting: best-effort schema tweaks");
      await runBestEffortStartupMigration();
      logger.info("[MIGRATION] Success: best-effort schema tweaks");

      // ── Seed gamification (best-effort) ──
      try {
        const { seedDefaultGamification } = await import("./lib/gamification");
        await seedDefaultGamification();
      } catch (e) {
        logger.warn(
          { err: e instanceof Error ? e.message : String(e) },
          "[MIGRATION] gamification seed — failed (non-fatal)",
        );
      }

      // ── Storage buckets (best-effort) ──
      ensureStorageBuckets().catch((e) =>
        logger.warn(
          { err: e instanceof Error ? e.message : String(e) },
          "Storage bucket setup: unexpected error",
        ),
      );

      // ── Auto-register Telegram webhook (best-effort) ───────────────────────
      // If TELEGRAM_BOT_TOKEN is set, register the webhook so Telegram starts
      // sending updates to this server immediately on startup.
      try {
        const { isTelegramConfigured, setWebhook, getBotInfo } = await import("./lib/telegram/client");
        if (isTelegramConfigured()) {
          const suffix = process.env.BASE44_PUBLIC_HOST_SUFFIX;
          const publicBaseUrl = process.env.PUBLIC_BASE_URL;
          const webhookUrl = publicBaseUrl
            ? `${publicBaseUrl}/api/telegram/webhook`
            : (suffix ? `https://3000-${suffix}/api/telegram/webhook` : null);

          if (webhookUrl) {
            const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET;
            await setWebhook(webhookUrl, secretToken);
            const bot = await getBotInfo();
            logger.info(
              { webhookUrl, bot: bot?.username },
              "[TELEGRAM] Webhook auto-registered on startup",
            );
          } else {
            logger.warn("[TELEGRAM] Cannot auto-register webhook — no public URL configured");
          }
        }
      } catch (e) {
        logger.warn(
          { err: e instanceof Error ? e.message : String(e) },
          "[TELEGRAM] Auto webhook registration failed (non-fatal)",
        );
      }

      // ── Mark ready ──
      app.set("isReady", true);
      logger.info("[SERVER] Initialization complete — ready");
      return;
    } catch (err) {
      if (client) {
        try { client.release(); } catch { /* already released */ }
      }
      logger.error(
        {
          err: err instanceof Error ? err.message : String(err),
          code: (err as any)?.code,
          attempt,
          maxRetries,
        },
        `[MIGRATION] FAILED attempt ${attempt}/${maxRetries}`,
      );
      if (attempt < maxRetries) {
        logger.info(`[SERVER] Retrying in ${retryDelayMs}ms...`);
        await new Promise((r) => setTimeout(r, retryDelayMs));
      }
    }
  }

  logger.error("[SERVER] Database initialization failed after all retries — shutting down");
  server.close(() => process.exit(1));
  // Force exit after 5s if server.close hangs
  setTimeout(() => process.exit(1), 5_000).unref();
}

initDatabase();
