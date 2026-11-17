import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { categories, ingredients } from "@/db/schema";
import type { UnitCode } from "@/domain/units";

export interface IngredientOption {
  readonly id: string;
  readonly name: string;
  readonly stockUnit: UnitCode;
  readonly category: string;
  readonly categoryId: string;
  readonly aliases: readonly string[];
}

export async function listIngredientOptions(userId: string): Promise<IngredientOption[]> {
  const rows = await getDb()
    .select({
      id: ingredients.id,
      name: ingredients.name,
      stockUnit: ingredients.stockUnit,
      category: categories.name,
      categoryId: ingredients.categoryId,
      aliases: ingredients.aliases,
    })
    .from(ingredients)
    .innerJoin(categories, eq(ingredients.categoryId, categories.id))
    .where(eq(ingredients.userId, userId))
    .orderBy(asc(categories.sortOrder), asc(ingredients.name));

  return rows.map((row) => ({
    ...row,
    stockUnit: row.stockUnit as UnitCode,
    aliases: row.aliases ?? [],
  }));
}
