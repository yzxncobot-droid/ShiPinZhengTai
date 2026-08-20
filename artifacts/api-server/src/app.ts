import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
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
    if ((req as any).originalUrl?.includes("/webhooks/temanqris")) {
      (req as any).rawBody = Buffer.from(buf);
    }
  },
}));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// optionalAuth runs first so req.user is populated for requests that carry a
// valid JWT.  maintenanceGuard then uses req.user?.role to let owners through
// even when maintenance mode is active.
app.use("/api", optionalAuth, maintenanceGuard(), router);

// ── Global JSON error handler ─────────────────────────────────────────────────
// Catches any error thrown (or passed via next(err)) inside a route handler and
// always responds with JSON — never with an HTML Express error page.
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  const status: number = typeof err.status === "number" ? err.status
    : typeof err.statusCode === "number" ? err.statusCode
    : 500;

  // Drizzle wraps the real PG error — unwrap it for a useful message
  const pgErr = err?.cause ?? err;
  const pgCode: string | undefined = pgErr?.code;
  const pgMessage: string | undefined = pgErr?.message ?? err?.message;

  logger.error(
    { err, method: req.method, url: req.url, pgCode, pgMessage },
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

  res.status(status).json({
    success: false,
    code: err.code ?? "INTERNAL_ERROR",
    message: pgMessage ?? "Terjadi kesalahan server",
  });
});

export default app;
