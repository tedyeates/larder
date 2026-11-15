import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

/**
 * Neon's Pool driver over WebSocket, not the HTTP driver: multi-row ledger
 * writes need real interactive transactions.
 *
 * The pool is created lazily so importing this module never throws in a build
 * or a unit test that doesn't touch the database.
 */

let pool: Pool | undefined;

export function getPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  pool ??= new Pool({ connectionString: url, max: 3 });
  return pool;
}

export function getDb() {
  return drizzle(getPool(), { schema });
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

export { schema };
