/**
 * Serverless entry point for Netlify Functions.
 *
 * Wraps the Express app with `serverless-http` so it can run as a single
 * Netlify Function handling all `/api/*` routes.  The DB schema is created
 * during the build step (drizzle-kit push + migrate.mjs), so the app is
 * ready to serve requests on cold start without running startup migrations
 * inside the function.
 */
import serverless from "serverless-http";
import app from "./app";

// Migrations run as a build step, so the DB is ready before the first request.
app.set("isReady", true);

export const handler = serverless(app);
