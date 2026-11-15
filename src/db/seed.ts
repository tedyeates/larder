import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { ingredients, users } from "./schema";
import { INGREDIENTS } from "./seed/ingredients";

/**
 * Seeds the starter catalogue for the single user, creating that user if this
 * is a fresh database. Safe to re-run: ingredients are matched on (user, slug).
 */

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const pool = new Pool({ connectionString: url, max: 2 });
  const db = drizzle(pool);

  try {
    let user = (await db.select().from(users).limit(1))[0];
    if (!user) {
      user = (await db.insert(users).values({ name: "Larder" }).returning())[0];
      if (!user) throw new Error("Could not create the default user");
      console.log(`Created user ${user.id}`);
    }

    const rows = INGREDIENTS.map((seed) => ({
      userId: user.id,
      name: seed.name,
      slug: slugify(seed.name),
      category: seed.category,
      aliases: [...(seed.aliases ?? [])],
      stockUnit: seed.stockUnit,
      gramsPer: seed.gramsPer ? { ...seed.gramsPer } : null,
      shelfLifeDays: seed.shelfLifeDays ?? null,
      minStock: seed.minStock ?? null,
    }));

    await db
      .insert(ingredients)
      .values(rows)
      .onConflictDoNothing({ target: [ingredients.userId, ingredients.slug] });

    const total = await db.select({ id: ingredients.id }).from(ingredients);
    console.log(`Catalogue ready: ${total.length} ingredients (${rows.length} seeded).`);
  } finally {
    await pool.end();
  }
}

await main();
