import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

// GET /api — liveness probe (always 200, no DB query, no external deps).
// The platform healthchecks this path; it must respond instantly.
router.get("/", (_req, res) => {
  res.json({ status: "ok", service: "api" });
});

// GET /api/healthz — liveness probe (always 200, no DB query).
router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// GET /api/readyz — readiness probe.
// Returns 200 only after DB init + migrations complete; 503 while starting.
// Does NOT query the database — reads an in-memory flag set by index.ts.
router.get("/readyz", (req, res) => {
  if (req.app.get("isReady") === true) {
    res.status(200).json({ status: "ready" });
  } else {
    res.status(503).json({ status: "not ready" });
  }
});

export default router;
