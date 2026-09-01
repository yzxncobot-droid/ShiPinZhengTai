import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const neonUrl = process.env.NEON_DATABASE_URL;
const localUrl = process.env.DATABASE_URL;

if (!neonUrl && !localUrl) {
  throw new Error(
    "NEON_DATABASE_URL (or DATABASE_URL) must be set. Did you forget to provision a database?",
  );
}

function createPool(url: string, useSsl: boolean): pg.Pool {
  return new Pool({
    connectionString: url,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

// Try Neon first (if configured). If the connection test fails — e.g. compute
// quota exceeded — fall back to the local Postgres so the app stays up. Neon
// data is never touched while falling back; when Neon recovers the app will
// use it again on next restart.
async function resolvePool(): Promise<pg.Pool> {
  if (neonUrl) {
    const neonPool = createPool(neonUrl, true);
    try {
      const client = await neonPool.connect();
      await client.query("SELECT 1");
      client.release();
      console.log("[DB] Connected to Neon (NEON_DATABASE_URL)");
      return neonPool;
    } catch (err) {
      console.warn(
        `[DB] Neon unavailable (${(err as Error).message}) — falling back to local Postgres`,
      );
      await neonPool.end();
    }
  }
  if (!localUrl) {
    throw new Error("DATABASE_URL must be set as a fallback when Neon is unavailable");
  }
  console.log("[DB] Connected to local Postgres (DATABASE_URL)");
  return createPool(localUrl, false);
}

const pool = await resolvePool();

export { pool };

export const db = drizzle(pool, {
  schema,
  // Log every SQL statement + parameters in development so INSERT failures
  // show the exact query in the API server console.
  logger: process.env.NODE_ENV === "development",
});

export * from "./schema";
