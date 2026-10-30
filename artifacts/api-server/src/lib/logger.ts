import pino from "pino";

// Serverless (Netlify Functions / Lambda) logs plain JSON — pino-pretty's worker
// transport can't be resolved once the bundle is re-packaged for the function.
const isProduction =
  process.env.NODE_ENV === "production" || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
