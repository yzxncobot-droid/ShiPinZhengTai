/**
 * Serverless entry point — wraps the Express app for Netlify Functions.
 * No `app.listen`; schema migrations run at build time (see migrate.ts).
 */
import serverless from "serverless-http";
import app from "./app";

app.set("isReady", true);

const FUNCTION_PREFIX = "/.netlify/functions/api";

export const handler = serverless(app, {
  binary: ["image/*", "video/*", "audio/*", "application/octet-stream", "application/pdf"],
  // Requests rewritten from /api/* normally keep their original path; if one
  // arrives on the raw function path, map it back to the /api mount.
  request(req: { url?: string }) {
    if (req.url?.startsWith(FUNCTION_PREFIX)) {
      req.url = "/api" + req.url.slice(FUNCTION_PREFIX.length);
    }
  },
});
