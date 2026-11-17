import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { categories } from "@/db/schema";
import { slugify } from "@/lib/slug";

export interface CategoryOption {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly sortOrder: number;
}

export async function listCategories(userId: string): Promise<CategoryOption[]> {
  return getDb()
    .select({
      id: categories.id,
      name: categories.name,
      slug: categories.slug,
      sortOrder: categories.sortOrder,
    })
    .from(categories)
    .where(eq(categories.userId, userId))
    .orderBy(asc(categories.sortOrder), asc(categories.name));
}

/**
 * Find a category by name, creating it if it doesn't exist. Categories are
 * per-user and matched on slug, so "Dry goods" and "dry goods" are the same.
 */
export async function ensureCategory(userId: string, name: string): Promise<CategoryOption> {
  const db = getDb();
  const trimmed = name.trim();
  const slug = slugify(trimmed);
  if (slug === "") throw new Error("A category needs a name");

  const [existing] = await db
    .select({
      id: categories.id,
      name: categories.name,
      slug: categories.slug,
      sortOrder: categories.sortOrder,
    })
    .from(categories)
    .where(and(eq(categories.userId, userId), eq(categories.slug, slug)))
    .limit(1);
  if (existing) return existing;

  const [highest] = await db
    .select({ max: categories.sortOrder })
    .from(categories)
    .where(eq(categories.userId, userId))
    .orderBy(desc(categories.sortOrder))
    .limit(1);

  const [created] = await db
    .insert(categories)
    .values({ userId, name: trimmed, slug, sortOrder: (highest?.max ?? -1) + 1 })
    .returning({
      id: categories.id,
      name: categories.name,
      slug: categories.slug,
      sortOrder: categories.sortOrder,
    });

  if (!created) throw new Error("Could not create that category");
  return created;
}
