import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { DEFAULT_CATEGORIES } from "../lib/ingredient-options";
import { slugify } from "../lib/slug";
import { verifiedConnectionString } from "./connection";
import { categories, ingredients, users } from "./schema";
import { INGREDIENTS } from "./seed/ingredients";

/**
 * Seeds the category list and starter catalogue for the single user, creating
 * that user if this is a fresh database. Safe to re-run: categories match on
 * (user, slug) and ingredients on (user, slug).
 */

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const pool = new Pool({ connectionString: verifiedConnectionString(url), max: 2 });
  const db = drizzle(pool);

  try {
    let user = (await db.select().from(users).limit(1))[0];
    if (!user) {
      user = (await db.insert(users).values({ name: "Larder" }).returning())[0];
      if (!user) throw new Error("Could not create the default user");
      console.log(`Created user ${user.id}`);
    }

    await db
      .insert(categories)
      .values(
        DEFAULT_CATEGORIES.map((category) => ({
          userId: user.id,
          name: category.name,
          slug: category.slug,
          sortOrder: category.sortOrder,
        })),
      )
      .onConflictDoNothing({ target: [categories.userId, categories.slug] });

    const categoryRows = await db
      .select()
      .from(categories)
      .where(eq(categories.userId, user.id));
    const bySlug = new Map(categoryRows.map((category) => [category.slug, category.id]));
    const fallback = bySlug.get("other");
    if (!fallback) throw new Error("The default 'Other' category is missing");

    const rows = INGREDIENTS.map((seed) => ({
      userId: user.id,
      name: seed.name,
      slug: slugify(seed.name),
      categoryId: bySlug.get(seed.category) ?? fallback,
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
