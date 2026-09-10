import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { fileURLToPath } from "node:url";
import nodePath from "node:path";
import nodeFs from "node:fs";
import router from "./routes";
import { logger } from "./lib/logger";
import { maintenanceGuard } from "./middlewares/maintenance";
import { optionalAuth } from "./middlewares/auth";

const app: Express = express();

// Trust the Replit proxy (mTLS reverse-proxy) so that X-Forwarded-* headers
// are honoured in production. Without this, Express sees the proxy IP as the
// client IP and may reject forwarded requests.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    // Distinguish actual unhandled errors (thrown exceptions) from deliberate
    // 5xx responses (e.g. 503 when BuatQris is not configured). Without this,
    // pino-http creates a fake Error("failed with status code 503") with a
    // stack trace for every deliberate 5xx, producing misleading error logs.
    customLogLevel: (_req, res, error) => {
      if (error) return "error";            // actual unhandled error → error level
      // Deliberate 5xx (e.g. 503 when BuatQris not configured, 502 gateway
      // errors) — the route handlers already log the real cause via logger
      // when there is one. Skip pino-http auto-logging so it doesn't create a
      // fake Error("failed with status code 503") with a misleading stack trace.
      if (res.statusCode >= 500) return "silent";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
    // Health probes run repeatedly and /readyz intentionally returns 503 while
    // startup migrations are still running. Exclude them from request logging
    // so expected readiness transitions do not produce misleading error stacks.
    autoLogging: {
      ignore: (req) => {
        const path = req.url?.split("?")[0];
        return path === "/api" || path === "/api/healthz" || path === "/api/readyz";
      },
    },
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Allow all origins – the app is served through Replit's proxy; the origin
// header will vary between dev (.replit.dev) and production (.replit.app).
app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(express.json({
  limit: "10mb",
  verify: (req, _res, buf) => {
    if ((req as any).originalUrl?.includes("/webhooks/buatqris")) {
      (req as any).rawBody = Buffer.from(buf);
    }
  },
}));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// optionalAuth runs first so req.user is populated for requests that carry a
// valid JWT.  maintenanceGuard then uses req.user?.role to let owners through
// even when maintenance mode is active.
app.use("/api", optionalAuth, maintenanceGuard(), router);

// ── 404 catch-all for API routes ──────────────────────────────────────────────
// Ensures unmatched /api/* paths return JSON instead of Express's default HTML.
app.use("/api", (req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    code: "NOT_FOUND",
    message: `Endpoint tidak ditemukan: ${req.method} ${req.url}`,
  });
});

// ── Serve built frontend (production only) ───────────────────────────────────
// In production, this Express server also serves the Vite-built frontend from
// artifacts/yzu-video/dist/public. In dev, Vite serves the frontend and proxies
// /api to this server, so this block is a no-op (the directory doesn't exist).
const frontendDist = nodePath.resolve(
  nodePath.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "yzu-video",
  "dist",
  "public",
);

if (nodeFs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  // SPA fallback: serve index.html for non-/api GET routes (client-side routing)
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) return next();
    res.sendFile(nodePath.join(frontendDist, "index.html"), (err) => {
      if (err) next(err);
    });
  });
}

// ── Global JSON error handler ─────────────────────────────────────────────────
// Catches any error thrown (or passed via next(err)) inside a route handler and
// always responds with JSON — never with an HTML Express error page.
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  // Guard: if headers were already sent (e.g. by a streaming route), we can't
  // send a new JSON response — just log and delegate to Express's default
  // handler which will close the connection.
  if (res.headersSent) {
    logger.error({ err: err?.message, method: req.method, url: req.url }, "Error after headers sent");
    _next(err);
    return;
  }

  try {
    const status: number = typeof err.status === "number" ? err.status
      : typeof err.statusCode === "number" ? err.statusCode
      : 500;

    // Drizzle wraps the real PG error — unwrap it for a useful message
    const pgErr = err?.cause ?? err;
    const pgCode: string | undefined = pgErr?.code;
    // Ensure message is always a string (never an object/undefined that breaks
    // JSON serialization or leaks a stack trace).
    const pgMessage: string = typeof pgErr?.message === "string"
      ? pgErr.message
      : typeof err?.message === "string" ? err.message : "Terjadi kesalahan server";

    logger.error(
      { err: err?.message ?? String(err), method: req.method, url: req.url, pgCode, pgMessage },
      "Unhandled route error",
    );

    // Map common PG/app error codes to meaningful API responses
    if (pgCode === "23505") {
      res.status(409).json({
        success: false,
        code: "DUPLICATE_ENTRY",
        message: "Username atau email sudah digunakan",
      });
      return;
    }
    if (pgCode === "42703") {
      // column does not exist — schema/DB mismatch
      res.status(500).json({
        success: false,
        code: "DB_SCHEMA_MISMATCH",
        message: `Database schema mismatch: ${pgMessage}`,
      });
      return;
    }

    // Don't expose internal error codes or stack traces — use a safe string
    const safeCode = typeof err.code === "string" ? err.code : "INTERNAL_ERROR";
    res.status(status).json({
      success: false,
      code: safeCode,
      message: pgMessage,
    });
  } catch (handlerErr) {
    // Absolute last resort: if the error handler itself fails, send a minimal
    // JSON response so the frontend never receives a non-JSON body.
    logger.error({ err: (handlerErr as any)?.message }, "Error handler itself failed");
    res.status(500).json({
      success: false,
      code: "INTERNAL_ERROR",
      message: "Terjadi kesalahan server",
    });
  }
});

export default app;
