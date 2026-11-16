"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import { ingredients, recipeIngredients, recipes } from "@/db/schema";
import { assertUnitCode, toBase, type UnitCode } from "@/domain/units";
import { auth } from "@/lib/auth/server";
import { getOrCreateAppUser } from "@/lib/users";

const lineInput = z.object({
  ingredientId: z.uuid(),
  quantity: z.coerce.number().positive().max(1_000_000),
  unit: z.string().min(1).max(16),
});

const recipeInput = z.object({
  title: z.string().trim().min(1).max(120),
  servings: z.coerce.number().int().min(1).max(24),
  steps: z.string().max(8000).optional(),
  lines: z.string().min(2),
});

export interface CreateRecipeResult {
  readonly error?: string;
  readonly recipeId?: string;
}

export interface UpdateRecipeResult {
  readonly error?: string;
  readonly recipeId?: string;
}

/** Replace a recipe's header and ingredient lines in one transaction. */
export async function updateRecipe(formData: FormData): Promise<UpdateRecipeResult> {
  const { data: session } = await auth.getSession();
  if (!session?.user) return { error: "You are signed out." };

  const parsed = recipeInput.extend({ recipeId: z.uuid() }).safeParse({
    recipeId: formData.get("recipeId"),
    title: formData.get("title"),
    servings: formData.get("servings"),
    steps: formData.get("steps") ?? undefined,
    lines: formData.get("lines"),
  });
  if (!parsed.success) return { error: "A recipe needs a title, servings, and ingredients." };

  let rawLines: unknown;
  try {
    rawLines = JSON.parse(parsed.data.lines);
  } catch {
    return { error: "The ingredient rows could not be read." };
  }

  const lines = z.array(lineInput).min(1).max(60).safeParse(rawLines);
  if (!lines.success) return { error: "Every ingredient needs an amount and a unit." };

  const appUser = await getOrCreateAppUser({
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  });
  const db = getDb();

  const [existing] = await db
    .select({ id: recipes.id })
    .from(recipes)
    .where(and(eq(recipes.id, parsed.data.recipeId), eq(recipes.userId, appUser.id)))
    .limit(1);
  if (!existing) return { error: "That recipe isn't yours." };

  const ids = [...new Set(lines.data.map((line) => line.ingredientId))];
  const catalogue = await db
    .select()
    .from(ingredients)
    .where(and(eq(ingredients.userId, appUser.id), inArray(ingredients.id, ids)));
  const byId = new Map(catalogue.map((item) => [item.id, item]));
  if (byId.size !== ids.length)
    return { error: "One of those ingredients isn't in your catalogue." };

  for (const line of lines.data) {
    const item = byId.get(line.ingredientId);
    if (!item) return { error: "One of those ingredients isn't in your catalogue." };
    try {
      toBase(line.quantity, assertUnitCode(line.unit), {
        id: item.id,
        name: item.name,
        stockUnit: item.stockUnit as UnitCode,
        gramsPer: item.gramsPer ?? undefined,
      });
    } catch {
      return { error: `${item.name}: ${line.unit} can't be converted to ${item.stockUnit}.` };
    }
  }

  const steps = (parsed.data.steps ?? "")
    .split("\n")
    .map((step) => step.trim())
    .filter((step) => step.length > 0)
    .map((text) => ({ text }));

  await db.transaction(async (tx) => {
    await tx
      .update(recipes)
      .set({
        title: parsed.data.title,
        servings: parsed.data.servings,
        steps,
      })
      .where(eq(recipes.id, existing.id));

    await tx.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, existing.id));

    await tx.insert(recipeIngredients).values(
      lines.data.map((line, index) => {
        const item = byId.get(line.ingredientId);
        if (!item) throw new Error("Ingredient disappeared");
        return {
          recipeId: existing.id,
          ingredientId: item.id,
          rawText: `${line.quantity} ${line.unit} ${item.name}`,
          quantity: line.quantity,
          unit: line.unit,
          sortOrder: index,
          parseStatus: "ok",
        };
      }),
    );
  });

  revalidatePath("/recipes");
  revalidatePath(`/recipes/${existing.id}`);
  return { recipeId: existing.id };
}

export async function createRecipe(formData: FormData): Promise<CreateRecipeResult> {
  const { data: session } = await auth.getSession();
  if (!session?.user) return { error: "You are signed out." };

  const parsed = recipeInput.safeParse({
    title: formData.get("title"),
    servings: formData.get("servings"),
    steps: formData.get("steps") ?? undefined,
    lines: formData.get("lines"),
  });
  if (!parsed.success) return { error: "A recipe needs a title, servings, and ingredients." };

  let rawLines: unknown;
  try {
    rawLines = JSON.parse(parsed.data.lines);
  } catch {
    return { error: "The ingredient rows could not be read." };
  }

  const lines = z.array(lineInput).min(1).max(60).safeParse(rawLines);
  if (!lines.success) return { error: "Every ingredient needs an amount and a unit." };

  const appUser = await getOrCreateAppUser({
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  });
  const db = getDb();

  const ids = [...new Set(lines.data.map((line) => line.ingredientId))];
  const catalogue = await db
    .select()
    .from(ingredients)
    .where(and(eq(ingredients.userId, appUser.id), inArray(ingredients.id, ids)));
  const byId = new Map(catalogue.map((item) => [item.id, item]));
  if (byId.size !== ids.length)
    return { error: "One of those ingredients isn't in your catalogue." };

  // Prove every line can be converted before anything is written.
  for (const line of lines.data) {
    const item = byId.get(line.ingredientId);
    if (!item) return { error: "One of those ingredients isn't in your catalogue." };
    try {
      toBase(line.quantity, assertUnitCode(line.unit), {
        id: item.id,
        name: item.name,
        stockUnit: item.stockUnit as UnitCode,
        gramsPer: item.gramsPer ?? undefined,
      });
    } catch {
      return { error: `${item.name}: ${line.unit} can't be converted to ${item.stockUnit}.` };
    }
  }

  const steps = (parsed.data.steps ?? "")
    .split("\n")
    .map((step) => step.trim())
    .filter((step) => step.length > 0)
    .map((text) => ({ text }));

  const recipeId = await db.transaction(async (tx) => {
    const [recipe] = await tx
      .insert(recipes)
      .values({
        userId: appUser.id,
        title: parsed.data.title,
        servings: parsed.data.servings,
        steps,
        createdBy: "manual",
      })
      .returning({ id: recipes.id });
    if (!recipe) throw new Error("Could not create the recipe");

    await tx.insert(recipeIngredients).values(
      lines.data.map((line, index) => {
        const item = byId.get(line.ingredientId);
        if (!item) throw new Error("Ingredient disappeared");
        return {
          recipeId: recipe.id,
          ingredientId: item.id,
          rawText: `${line.quantity} ${line.unit} ${item.name}`,
          quantity: line.quantity,
          unit: line.unit,
          sortOrder: index,
          parseStatus: "ok",
        };
      }),
    );
    return recipe.id;
  });

  revalidatePath("/recipes");
  return { recipeId };
}
