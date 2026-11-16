"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import {
  cookEvents,
  ingredients,
  leftovers,
  mealPlanEntries,
  mealPlans,
  recipeIngredients,
  recipes,
  stockEntries,
} from "@/db/schema";
import { addDays, todayIso } from "@/domain/dates";
import { planDeduction, type StockEntry } from "@/domain/ledger";
import { splitPortions } from "@/domain/leftovers";
import { type RecipeLine, scaleRecipe } from "@/domain/plan";
import { formatQuantity, isUnitCode, type UnitCode } from "@/domain/units";
import { auth } from "@/lib/auth/server";
import { getOrCreateAppUser } from "@/lib/users";

const cookInput = z.object({
  entryId: z.uuid(),
  eatenNow: z.coerce.number().min(0).max(24).default(1),
});

export interface CookResult {
  readonly error?: string;
  readonly message?: string;
  readonly shortfalls?: readonly string[];
}

export async function cookEntry(input: unknown): Promise<CookResult> {
  const parsed = cookInput.safeParse(input);
  if (!parsed.success) return { error: "That cook request was malformed." };

  const { data: session } = await auth.getSession();
  if (!session?.user) return { error: "You are signed out." };

  const user = await getOrCreateAppUser({
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  });
  const db = getDb();

  const [entry] = await db
    .select({
      id: mealPlanEntries.id,
      planId: mealPlanEntries.planId,
      kind: mealPlanEntries.kind,
      recipeId: mealPlanEntries.recipeId,
      leftoverId: mealPlanEntries.leftoverId,
      portions: mealPlanEntries.portions,
      status: mealPlanEntries.status,
      week: mealPlans.weekStart,
    })
    .from(mealPlanEntries)
    .innerJoin(mealPlans, eq(mealPlanEntries.planId, mealPlans.id))
    .where(and(eq(mealPlanEntries.id, parsed.data.entryId), eq(mealPlans.userId, user.id)))
    .limit(1);

  if (!entry) return { error: "That meal isn't on your plan." };
  if (entry.status !== "planned") return { error: "That meal is already done." };

  const today = todayIso();

  // A leftover is a meal with no deduction: the ingredients left the pantry
  // when it was cooked. A planned leftover with no batch yet cannot be eaten —
  // that is how five portions got scheduled out of a two-portion dinner.
  if (entry.kind === "leftover") {
    if (!entry.leftoverId) {
      return { error: "That dish hasn't been cooked yet, so there are no leftovers to eat." };
    }

    await db
      .update(mealPlanEntries)
      .set({ status: "eaten" })
      .where(eq(mealPlanEntries.id, entry.id));

    revalidatePath(`/plan/${entry.week}`);
    revalidatePath("/plan");
    return { message: "Eaten. Nothing came out of the pantry." };
  }

  if (!entry.recipeId) return { error: "That entry has no recipe." };

  const [recipe] = await db
    .select({ id: recipes.id, title: recipes.title, servings: recipes.servings })
    .from(recipes)
    .where(and(eq(recipes.id, entry.recipeId), eq(recipes.userId, user.id)))
    .limit(1);
  if (!recipe) return { error: "That recipe is gone." };

  const [lines, catalogue, lots] = await Promise.all([
    db.select().from(recipeIngredients).where(eq(recipeIngredients.recipeId, recipe.id)),
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

  const recipeLines: RecipeLine[] = lines.map((line) => ({
    ingredientId: line.ingredientId,
    quantity: line.quantity,
    unit: line.unit !== null && isUnitCode(line.unit) ? line.unit : null,
    optional: line.isOptional,
    label: line.rawText,
  }));

  const scaled = scaleRecipe(
    recipeLines,
    { portions: entry.portions, recipeServings: recipe.servings },
    ingredientMap,
  );

  const byIngredient = new Map<string, StockEntry[]>();
  for (const lot of lots) {
    const list = byIngredient.get(lot.ingredientId) ?? [];
    list.push({
      id: lot.id,
      ingredientId: lot.ingredientId,
      quantity: lot.quantity,
      acquiredAt: lot.acquiredAt,
      bestBefore: lot.bestBefore,
      reason: lot.reason,
    });
    byIngredient.set(lot.ingredientId, list);
  }

  const split = splitPortions(entry.portions, parsed.data.eatenNow);
  const shortfalls: string[] = [];

  await db.transaction(async (tx) => {
    const [event] = await tx
      .insert(cookEvents)
      .values({
        userId: user.id,
        recipeId: recipe.id,
        planEntryId: entry.id,
        portionsCooked: split.portionsCooked,
        eatenNow: split.eatenNow,
        cookedAt: today,
        shortfallCount: 0,
      })
      .returning({ id: cookEvents.id });
    if (!event) throw new Error("Could not record the cook");

    for (const requirement of scaled.requirements) {
      const deduction = planDeduction(
        byIngredient.get(requirement.ingredientId) ?? [],
        requirement.amount,
      );
      const item = ingredientMap.get(requirement.ingredientId);

      for (const consumption of deduction.consumptions) {
        await tx.insert(stockEntries).values({
          userId: user.id,
          ingredientId: requirement.ingredientId,
          quantity: -consumption.amount,
          reason: "cook",
          acquiredAt: today,
          cookEventId: event.id,
        });
      }

      if (deduction.shortfall > 0 && item) {
        shortfalls.push(
          `${item.name}: needed ${formatQuantity(requirement.amount, item)}, had ${formatQuantity(deduction.available, item)}`,
        );
      }
    }

    if (shortfalls.length > 0) {
      await tx
        .update(cookEvents)
        .set({ shortfallCount: shortfalls.length })
        .where(eq(cookEvents.id, event.id));
    }

    await tx
      .update(mealPlanEntries)
      .set({ status: "cooked", cookEventId: event.id })
      .where(eq(mealPlanEntries.id, entry.id));

    const reservations = await tx
      .select({ id: mealPlanEntries.id, portions: mealPlanEntries.portions })
      .from(mealPlanEntries)
      .where(
        and(
          eq(mealPlanEntries.planId, entry.planId),
          eq(mealPlanEntries.kind, "leftover"),
          eq(mealPlanEntries.recipeId, recipe.id),
          isNull(mealPlanEntries.leftoverId),
          eq(mealPlanEntries.status, "planned"),
        ),
      );

    let available = split.leftoverPortions;

    if (available > 0) {
      const [batch] = await tx
        .insert(leftovers)
        .values({
          userId: user.id,
          cookEventId: event.id,
          recipeId: recipe.id,
          label: recipe.title,
          portions: available,
          storedAt: today,
          bestBefore: addDays(today, 3),
          status: "available",
        })
        .returning({ id: leftovers.id });

      if (batch) {
        // Attach the residuals that were planned before the cook, taking their
        // portions out of the batch so availability and reservations add up.
        for (const reservation of reservations) {
          const take = Math.min(available, reservation.portions);
          if (take <= 0) {
            await tx
              .update(mealPlanEntries)
              .set({ status: "skipped" })
              .where(eq(mealPlanEntries.id, reservation.id));
            continue;
          }
          await tx
            .update(mealPlanEntries)
            .set({ leftoverId: batch.id, portions: take })
            .where(eq(mealPlanEntries.id, reservation.id));
          available -= take;
        }

        await tx
          .update(leftovers)
          .set({ portions: available, status: available <= 0 ? "reserved" : "available" })
          .where(eq(leftovers.id, batch.id));
      }
    } else {
      for (const reservation of reservations) {
        await tx
          .update(mealPlanEntries)
          .set({ status: "skipped" })
          .where(eq(mealPlanEntries.id, reservation.id));
      }
    }
  });

  revalidatePath(`/plan/${entry.week}`);
  revalidatePath("/plan");
  revalidatePath("/pantry");

  const leftoverNote =
    split.leftoverPortions > 0 ? ` ${split.leftoverPortions} portion(s) saved as leftovers.` : "";
  const shortfallNote = shortfalls.length > 0 ? ` Short: ${shortfalls.join("; ")}.` : "";

  return { message: `${recipe.title} cooked.${leftoverNote}${shortfallNote}`, shortfalls };
}
