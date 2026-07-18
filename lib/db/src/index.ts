import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const connectionString = process.env.NEON_DATABASE_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "NEON_DATABASE_URL (or DATABASE_URL) must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }, // required for Neon PostgreSQL
  max: 10,
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
