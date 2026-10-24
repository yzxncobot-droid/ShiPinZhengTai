import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const connectionString = process.env.NEON_DATABASE_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  // Don't crash at module load — the server needs to start so health checks
  // work and the error is visible in logs. initDatabase() in index.ts will
  // catch the connection failure and retry/shutdown gracefully.
  // eslint-disable-next-line no-console
  console.error(
    "[DB] WARNING: NEON_DATABASE_URL (or DATABASE_URL) is not set. " +
      "The server will start but database operations will fail until a connection string is provided.",
  );
}

export const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }, // required for Neon PostgreSQL
  // This is a long-lived server (not a serverless function), so the pool must be
  // large enough for concurrent video streams (up to 20 slots) PLUS the AutoUP /
  // import-queue background pollers. With max=3 the pollers were starved by
  // in-flight streams and failed with "Connection terminated due to connection
  // timeout" every poll cycle.
  max: Number(process.env.DB_POOL_MAX ?? 15),
  idleTimeoutMillis: 30_000,
  // Waiting for a free connection under load is normal — give it more than the
  // previous 5 s before declaring a timeout.
  connectionTimeoutMillis: 15_000,
});

export const db = drizzle(pool, {
  schema,
  // SQL parameter logs can expose credentials stored in app_secrets (such as
  // the Telegram MTProto session), so keep query logging disabled.
  logger: false,
});

export * from "./schema";
