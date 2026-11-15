import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { ingredients } from "@/db/schema";
import type { UnitCode } from "@/domain/units";

export interface IngredientOption {
  readonly id: string;
  readonly name: string;
  readonly stockUnit: UnitCode;
  readonly category: string;
}

export async function listIngredientOptions(userId: string): Promise<IngredientOption[]> {
  const rows = await getDb()
    .select({
      id: ingredients.id,
      name: ingredients.name,
      stockUnit: ingredients.stockUnit,
      category: ingredients.category,
    })
    .from(ingredients)
    .where(eq(ingredients.userId, userId))
    .orderBy(asc(ingredients.name));

  return rows.map((row) => ({ ...row, stockUnit: row.stockUnit as UnitCode }));
}
