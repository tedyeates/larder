"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import {
  ingredients,
  mealPlanEntries,
  mealPlans,
  recipeIngredients,
  recipes,
  shoppingItems,
  shoppingLists,
  stockEntries,
} from "@/db/schema";
import { addDays, todayIso } from "@/domain/dates";
import { balance } from "@/domain/ledger";
import { diffAgainstPantry, planRequirements } from "@/domain/plan";
import { assertUnitCode, baseUnitFor, isUnitCode, toBase, type UnitCode } from "@/domain/units";
import { auth } from "@/lib/auth/server";
import { getOpenList } from "@/lib/shop";
import { getOrCreateAppUser } from "@/lib/users";

async function context() {
  const { data: session } = await auth.getSession();
  if (!session?.user) return null;
  return getOrCreateAppUser({
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  });
}

export interface ShopResult {
  readonly error?: string;
  readonly message?: string;
}

const weekInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function generateShoppingList(week: unknown): Promise<ShopResult> {
  const parsed = weekInput.safeParse(week);
  if (!parsed.success) return { error: "That week doesn't look right." };

  const user = await context();
  if (!user) return { error: "You are signed out." };
  const db = getDb();

  const planned = await db
    .select({ recipeId: mealPlanEntries.recipeId, portions: mealPlanEntries.portions })
    .from(mealPlanEntries)
    .innerJoin(mealPlans, eq(mealPlanEntries.planId, mealPlans.id))
    .where(
      and(
        eq(mealPlans.userId, user.id),
        eq(mealPlans.weekStart, parsed.data),
        eq(mealPlanEntries.kind, "recipe"),
        eq(mealPlanEntries.status, "planned"),
      ),
    );

  const meals = planned.flatMap((row) =>
    row.recipeId === null ? [] : [{ recipeId: row.recipeId, portions: row.portions }],
  );
  if (meals.length === 0) return { message: "Nothing planned that week. Add a meal first." };

  const recipeIds = [...new Set(meals.map((meal) => meal.recipeId))];
  const [recipeRows, lineRows, catalogue, lots] = await Promise.all([
    db
      .select()
      .from(recipes)
      .where(and(eq(recipes.userId, user.id))),
    db.select().from(recipeIngredients),
    db.select().from(ingredients).where(eq(ingredients.userId, user.id)),
    db.select().from(stockEntries).where(eq(stockEntries.userId, user.id)),
  ]);

  const ingredientMap = new Map(
    catalogue.map((item) => [
      item.id,
      {
        id: item.id,
        name: item.name,
        stockUnit: item.stockUnit as UnitCode,
        gramsPer: item.gramsPer ?? undefined,
      },
    ]),
  );

  const recipeMap = new Map(
    recipeRows
      .filter((recipe) => recipeIds.includes(recipe.id))
      .map((recipe) => [
        recipe.id,
        {
          servings: recipe.servings,
          lines: lineRows
            .filter((line) => line.recipeId === recipe.id)
            .map((line) => ({
              ingredientId: line.ingredientId,
              quantity: line.quantity,
              unit: line.unit !== null && isUnitCode(line.unit) ? line.unit : null,
              optional: line.isOptional,
              label: line.rawText,
            })),
        },
      ]),
  );

  const { requirements } = planRequirements(meals, recipeMap, ingredientMap);

  const balances = new Map<string, number>();
  for (const item of ingredientMap.keys()) {
    balances.set(
      item,
      balance(
        lots
          .filter((lot) => lot.ingredientId === item)
          .map((lot) => ({
            id: lot.id,
            ingredientId: lot.ingredientId,
            quantity: lot.quantity,
            acquiredAt: lot.acquiredAt,
            bestBefore: lot.bestBefore,
            reason: lot.reason,
          })),
      ),
    );
  }

  const shortfalls = diffAgainstPantry(requirements, balances);
  if (shortfalls.length === 0) return { message: "The pantry already covers that week." };

  const list = await getOpenList(user.id);
  let written = 0;

  for (const shortfall of shortfalls) {
    const item = ingredientMap.get(shortfall.ingredientId);
    if (!item) continue;

    const [existing] = await db
      .select({ id: shoppingItems.id, status: shoppingItems.status })
      .from(shoppingItems)
      .where(
        and(
          eq(shoppingItems.listId, list.id),
          eq(shoppingItems.ingredientId, item.id),
          eq(shoppingItems.origin, "generated"),
        ),
      )
      .limit(1);

    if (existing && existing.status === "pending") {
      await db
        .update(shoppingItems)
        .set({ quantity: shortfall.shortfall, unit: baseUnitFor(item.stockUnit) })
        .where(eq(shoppingItems.id, existing.id));
      written += 1;
      continue;
    }
    if (existing) continue; // bought or removed already: leave it alone

    await db.insert(shoppingItems).values({
      listId: list.id,
      ingredientId: item.id,
      label: item.name,
      quantity: shortfall.shortfall,
      unit: baseUnitFor(item.stockUnit),
      origin: "generated",
      status: "pending",
    });
    written += 1;
  }

  revalidatePath("/shop");
  return { message: `${written} item(s) added to the list.` };
}

export async function tickShoppingItem(itemId: string): Promise<ShopResult> {
  const user = await context();
  if (!user) return { error: "You are signed out." };
  const db = getDb();

  const [row] = await db
    .select({
      id: shoppingItems.id,
      ingredientId: shoppingItems.ingredientId,
      label: shoppingItems.label,
      quantity: shoppingItems.quantity,
      unit: shoppingItems.unit,
      status: shoppingItems.status,
    })
    .from(shoppingItems)
    .innerJoin(shoppingLists, eq(shoppingItems.listId, shoppingLists.id))
    .where(and(eq(shoppingItems.id, itemId), eq(shoppingLists.userId, user.id)))
    .limit(1);

  if (!row) return { error: "That item is gone." };
  if (row.status !== "pending") return { message: "Already ticked." };

  if (
    row.ingredientId === null ||
    row.quantity === null ||
    row.unit === null ||
    !isUnitCode(row.unit)
  ) {
    await db
      .update(shoppingItems)
      .set({ status: "ticked", tickedAt: new Date() })
      .where(eq(shoppingItems.id, row.id));
    revalidatePath("/shop");
    return { message: `${row.label} ticked.` };
  }

  const [item] = await db
    .select()
    .from(ingredients)
    .where(and(eq(ingredients.id, row.ingredientId), eq(ingredients.userId, user.id)))
    .limit(1);
  if (!item) return { error: "That ingredient is gone." };

  let amount: number;
  try {
    amount = toBase(row.quantity, assertUnitCode(row.unit), {
      id: item.id,
      name: item.name,
      stockUnit: item.stockUnit as UnitCode,
      gramsPer: item.gramsPer ?? undefined,
    });
  } catch {
    return { error: `${row.label}: ${row.unit} can't be converted.` };
  }

  const today = todayIso();
  const bestBefore = item.shelfLifeDays === null ? null : addDays(today, item.shelfLifeDays);

  await db.transaction(async (tx) => {
    const [entry] = await tx
      .insert(stockEntries)
      .values({
        userId: user.id,
        ingredientId: item.id,
        quantity: amount,
        unitAsEntered: row.unit,
        quantityAsEntered: row.quantity,
        reason: "purchase",
        acquiredAt: today,
        bestBefore,
        shoppingItemId: row.id,
      })
      .returning({ id: stockEntries.id });

    await tx
      .update(shoppingItems)
      .set({ status: "ticked", tickedAt: new Date(), resultingStockEntryId: entry?.id })
      .where(eq(shoppingItems.id, row.id));
  });

  revalidatePath("/shop");
  revalidatePath("/pantry");
  return { message: `${row.label} added to the pantry.` };
}

const manualInput = z.object({
  label: z.string().trim().min(1).max(80),
  ingredientId: z.uuid().optional(),
  quantity: z.coerce.number().positive().max(1_000_000).optional(),
  unit: z.string().min(1).max(16).optional(),
});

export async function addManualItem(input: unknown): Promise<ShopResult> {
  const parsed = manualInput.safeParse(input);
  if (!parsed.success) return { error: "Give the item a name." };

  const user = await context();
  if (!user) return { error: "You are signed out." };
  const db = getDb();
  const list = await getOpenList(user.id);

  let unit = parsed.data.unit;
  if (!unit && parsed.data.ingredientId) {
    const [item] = await db
      .select()
      .from(ingredients)
      .where(eq(ingredients.id, parsed.data.ingredientId))
      .limit(1);
    if (item) unit = baseUnitFor(item.stockUnit as UnitCode);
  }

  await db.insert(shoppingItems).values({
    listId: list.id,
    ingredientId: parsed.data.ingredientId ?? null,
    label: parsed.data.label,
    quantity: parsed.data.quantity ?? null,
    unit: unit ?? null,
    origin: "manual",
    status: "pending",
  });

  revalidatePath("/shop");
  return { message: `${parsed.data.label} added.` };
}

export async function removeShoppingItem(itemId: string): Promise<ShopResult> {
  const user = await context();
  if (!user) return { error: "You are signed out." };

  const db = getDb();
  const [row] = await db
    .select({ id: shoppingItems.id })
    .from(shoppingItems)
    .innerJoin(shoppingLists, eq(shoppingItems.listId, shoppingLists.id))
    .where(and(eq(shoppingItems.id, itemId), eq(shoppingLists.userId, user.id)))
    .limit(1);
  if (!row) return { error: "That item is gone." };

  await db.update(shoppingItems).set({ status: "removed" }).where(eq(shoppingItems.id, row.id));
  revalidatePath("/shop");
  return { message: "Removed." };
}
