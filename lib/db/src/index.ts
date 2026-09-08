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
  // Serverless-friendly: each function instance gets its own pool. A small max
  // prevents connection exhaustion when many cold starts open pools concurrently.
  max: Number(process.env.DB_POOL_MAX ?? 3),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export const db = drizzle(pool, {
  schema,
  // Log every SQL statement + parameters in development so INSERT failures
  // show the exact query in the API server console.
  logger: process.env.NODE_ENV === "development",
});

export * from "./schema";
