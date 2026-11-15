import { attachDatabasePool } from "@vercel/functions";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * Postgres via node-postgres, as Neon recommends for Vercel: Fluid compute
 * keeps instances warm, so a real pool is safe, and `attachDatabasePool` makes
 * sure the connection is released before the function suspends.
 *
 * The app always talks through the pooled `DATABASE_URL`. Migrations use
 * `DATABASE_URL_UNPOOLED`, because PgBouncer's transaction mode can't carry DDL.
 *
 * Created lazily so importing this module never throws during a build or a unit
 * test that doesn't touch the database.
 */

let pool: Pool | undefined;

export function getPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  if (pool === undefined) {
    pool = new Pool({ connectionString: url, max: 3 });
    if (process.env.VERCEL === "1") attachDatabasePool(pool);
  }

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
