"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import { categories, ingredients, stockEntries } from "@/db/schema";
import { assertUnitCode, convertBetweenIngredients, type UnitCode } from "@/domain/units";
import { auth } from "@/lib/auth/server";
import { ensureCategory } from "@/lib/categories";
import { slugify } from "@/lib/slug";
import { getOrCreateAppUser } from "@/lib/users";

const input = z.object({
  name: z.string().trim().min(1).max(80),
  category: z.string().trim().max(40).optional(),
  stockUnit: z.string().min(1).max(16),
  gramsPerUnit: z.coerce.number().positive().max(100_000).optional(),
});

export interface CreatedIngredient {
  readonly id: string;
  readonly name: string;
  readonly stockUnit: UnitCode;
  readonly category: string;
  readonly categoryId: string;
  readonly aliases: string[];
}

export interface UpdateUnitResult {
  readonly error?: string;
  readonly message?: string;
}

const categoryChangeInput = z.object({
  ingredientId: z.uuid(),
  category: z.string().trim().min(1).max(40),
});

export interface UpdateCategoryResult {
  readonly error?: string;
  readonly message?: string;
}

/** Move an ingredient into an existing or newly named category. */
export async function updateIngredientCategory(raw: unknown): Promise<UpdateCategoryResult> {
  const parsed = categoryChangeInput.safeParse(raw);
  if (!parsed.success) return { error: "Give the category a name." };

  const { data: session } = await auth.getSession();
  if (!session?.user) return { error: "You are signed out." };

  const user = await getOrCreateAppUser({
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  });
  const db = getDb();

  const [ingredient] = await db
    .select({ id: ingredients.id })
    .from(ingredients)
    .where(and(eq(ingredients.id, parsed.data.ingredientId), eq(ingredients.userId, user.id)))
    .limit(1);
  if (!ingredient) return { error: "That ingredient isn't yours." };

  const category = await ensureCategory(user.id, parsed.data.category);
  await db
    .update(ingredients)
    .set({ categoryId: category.id })
    .where(eq(ingredients.id, ingredient.id));

  revalidatePath("/pantry");
  return { message: `Moved to ${category.name}.` };
}

const unitChangeInput = z.object({  ingredientId: z.uuid(),
  stockUnit: z.string().min(1).max(16),
  /** Grams per one of the new unit, when the units need a bridge. */
  gramsPerUnit: z.coerce.number().positive().max(100_000).optional(),
});

/**
 * Change how an ingredient is counted, converting every existing ledger row so
 * the stock means the same amount of food afterwards. Cross-family changes need
 * a gram weight; without one we refuse rather than silently corrupt stock.
 */
export async function updateIngredientUnit(raw: unknown): Promise<UpdateUnitResult> {
  const parsed = unitChangeInput.safeParse(raw);
  if (!parsed.success) return { error: "Choose a unit first." };

  const { data: session } = await auth.getSession();
  if (!session?.user) return { error: "You are signed out." };

  const user = await getOrCreateAppUser({
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  });
  const db = getDb();

  const [ingredient] = await db
    .select()
    .from(ingredients)
    .where(and(eq(ingredients.id, parsed.data.ingredientId), eq(ingredients.userId, user.id)))
    .limit(1);
  if (!ingredient) return { error: "That ingredient isn't yours." };

  let newUnit: UnitCode;
  try {
    newUnit = assertUnitCode(parsed.data.stockUnit);
  } catch {
    return { error: `Unknown unit: ${parsed.data.stockUnit}` };
  }

  const gramsPer: Record<string, number> = { ...(ingredient.gramsPer ?? {}) };
  if (parsed.data.gramsPerUnit !== undefined) {
    gramsPer[newUnit] = parsed.data.gramsPerUnit;
  }

  const from = {
    id: ingredient.id,
    name: ingredient.name,
    stockUnit: ingredient.stockUnit as UnitCode,
    gramsPer: ingredient.gramsPer ?? undefined,
  };
  const to = {
    id: ingredient.id,
    name: ingredient.name,
    stockUnit: newUnit,
    gramsPer,
  };

  if (ingredient.stockUnit === newUnit) {
    await db.update(ingredients).set({ gramsPer }).where(eq(ingredients.id, ingredient.id));
    revalidatePath("/pantry");
    return { message: `Updated the conversion for ${ingredient.name}.` };
  }

  const lots = await db
    .select({ id: stockEntries.id, quantity: stockEntries.quantity })
    .from(stockEntries)
    .where(eq(stockEntries.ingredientId, ingredient.id));

  let conversions: { id: string; quantity: number }[];
  try {
    conversions = lots.map((lot) => ({
      id: lot.id,
      quantity: convertBetweenIngredients(lot.quantity, from, to),
    }));
  } catch {
    return {
      error: `I can't convert ${ingredient.stockUnit} to ${newUnit} without a weight. Enter how many grams one ${newUnit} is.`,
    };
  }

  await db.transaction(async (tx) => {
    for (const row of conversions) {
      await tx
        .update(stockEntries)
        .set({ quantity: row.quantity, unitAsEntered: null, quantityAsEntered: null })
        .where(eq(stockEntries.id, row.id));
    }
    await tx
      .update(ingredients)
      .set({ stockUnit: newUnit, gramsPer })
      .where(eq(ingredients.id, ingredient.id));
  });

  revalidatePath("/pantry");
  return { message: `${ingredient.name} is now counted in ${newUnit}.` };
}

export interface CreateIngredientResult {
  readonly error?: string;
  readonly ingredient?: CreatedIngredient;
}

/**
 * Create a catalogue ingredient inline. Idempotent by slug: if you type a name
 * you already have, you get the existing row back rather than a duplicate.
 */
export async function createIngredient(raw: unknown): Promise<CreateIngredientResult> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { error: "Give the ingredient a name and a unit." };

  const { data: session } = await auth.getSession();
  if (!session?.user) return { error: "You are signed out." };

  const user = await getOrCreateAppUser({
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  });

  let stockUnit: UnitCode;
  try {
    stockUnit = assertUnitCode(parsed.data.stockUnit);
  } catch {
    return { error: `Unknown unit: ${parsed.data.stockUnit}` };
  }

  const db = getDb();
  const slug = slugify(parsed.data.name);
  if (slug === "") return { error: "That name has no letters or numbers." };

  const [existing] = await db
    .select()
    .from(ingredients)
    .where(and(eq(ingredients.userId, user.id), eq(ingredients.slug, slug)))
    .limit(1);

  if (existing) {
    const [existingCategory] = await db
      .select({ name: categories.name })
      .from(categories)
      .where(eq(categories.id, existing.categoryId))
      .limit(1);
    return {
      ingredient: {
        id: existing.id,
        name: existing.name,
        stockUnit: existing.stockUnit as UnitCode,
        category: existingCategory?.name ?? "Other",
        categoryId: existing.categoryId,
        aliases: existing.aliases,
      },
    };
  }

  const category = await ensureCategory(user.id, parsed.data.category?.trim() || "Other");

  // A per-piece weight is optional, but a counted item stocked in grams is
  // useless without one, so capture it when the user supplies it.
  const gramsPer =
    parsed.data.gramsPerUnit !== undefined && stockUnit === "each"
      ? { each: parsed.data.gramsPerUnit }
      : null;
  const shelfLife =
    category.slug === "frozen" ? 180 : category.slug === "tins" || category.slug === "dry" ? 730 : 7;

  const [created] = await db
    .insert(ingredients)
    .values({
      userId: user.id,
      name: parsed.data.name,
      slug,
      categoryId: category.id,
      stockUnit,
      gramsPer,
      shelfLifeDays: shelfLife,
    })
    .returning();

  if (!created) return { error: "Could not create that ingredient." };

  revalidatePath("/pantry");

  return {
    ingredient: {
      id: created.id,
      name: created.name,
      stockUnit: created.stockUnit as UnitCode,
      category: category.name,
      categoryId: category.id,
      aliases: created.aliases,
    },
  };
}
