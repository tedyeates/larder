import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { slugify } from "../lib/slug";
import { verifiedConnectionString } from "./connection";
import { ingredients } from "./schema";
import { KNOWN_GRAMS } from "./seed/grams";
import { INGREDIENTS } from "./seed/ingredients";

/**
 * Fill in missing gram weights on existing catalogue rows.
 *
 * Seed hints are merged in first, then the curated additions in
 * `seed/grams.ts`. Existing weights always win, so this is safe to re-run and
 * never overwrites a weight a human or agent has already set. It does not
 * change stock units or any ledger entry.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const dryRun = process.argv.includes("--dry-run");
  const pool = new Pool({ connectionString: verifiedConnectionString(url), max: 2 });
  const db = drizzle(pool);

  try {
    const rows = await db.select().from(ingredients);
    const seedBySlug = new Map(INGREDIENTS.map((seed) => [slugify(seed.name), seed]));
    let touched = 0;

    for (const row of rows) {
      const hints: Record<string, number> = { ...(row.gramsPer ?? {}) };
      const added: Record<string, number> = {};
      const sources = [seedBySlug.get(row.slug)?.gramsPer, KNOWN_GRAMS[row.slug]];

      for (const source of sources) {
        for (const [unit, grams] of Object.entries(source ?? {})) {
          if (hints[unit] !== undefined) continue;
          hints[unit] = grams;
          added[unit] = grams;
        }
      }

      if (Object.keys(added).length === 0) continue;

      if (!dryRun) {
        await db.update(ingredients).set({ gramsPer: hints }).where(eq(ingredients.id, row.id));
      }
      touched += 1;
      console.log(`${row.name}: +${JSON.stringify(added)}`);
    }

    console.log(
      `${dryRun ? "Would backfill" : "Backfilled"} ${touched} ingredient(s) of ${rows.length}.`,
    );
  } finally {
    await pool.end();
  }
}

await main();
