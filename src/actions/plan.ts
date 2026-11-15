"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import { leftovers, mealPlanEntries, mealPlans, recipes } from "@/db/schema";
import { auth } from "@/lib/auth/server";
import { ensurePlan } from "@/lib/plan";
import { getOrCreateAppUser } from "@/lib/users";

const weekInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const slotInput = z.enum(["lunch", "dinner"]);

async function context() {
  const { data: session } = await auth.getSession();
  if (!session?.user) return null;
  return getOrCreateAppUser({
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  });
}

export interface PlanActionResult {
  readonly error?: string;
  readonly message?: string;
}

const addRecipeInput = z.object({
  week: weekInput,
  day: weekInput,
  slot: slotInput,
  recipeId: z.uuid(),
  portions: z.coerce.number().positive().max(24),
});

export async function addRecipeToPlan(input: unknown): Promise<PlanActionResult> {
  const parsed = addRecipeInput.safeParse(input);
  if (!parsed.success) return { error: "Pick a recipe and a portion count." };

  const user = await context();
  if (!user) return { error: "You are signed out." };

  const db = getDb();
  const [recipe] = await db
    .select({ id: recipes.id, title: recipes.title })
    .from(recipes)
    .where(and(eq(recipes.id, parsed.data.recipeId), eq(recipes.userId, user.id)))
    .limit(1);
  if (!recipe) return { error: "That recipe isn't yours." };

  const planId = await ensurePlan(user.id, parsed.data.week);

  await db
    .insert(mealPlanEntries)
    .values({
      planId,
      day: parsed.data.day,
      slot: parsed.data.slot,
      kind: "recipe",
      recipeId: recipe.id,
      portions: parsed.data.portions,
      status: "planned",
    })
    .onConflictDoUpdate({
      target: [mealPlanEntries.planId, mealPlanEntries.day, mealPlanEntries.slot],
      set: {
        kind: "recipe",
        recipeId: recipe.id,
        leftoverId: null,
        portions: parsed.data.portions,
        status: "planned",
        cookEventId: null,
      },
    });

  revalidatePath(`/plan/${parsed.data.week}`);
  return { message: `${recipe.title} added.` };
}

const addLeftoverInput = z.object({
  week: weekInput,
  day: weekInput,
  slot: slotInput,
  leftoverId: z.uuid(),
  portions: z.coerce.number().positive().max(24),
});

export async function addLeftoverToPlan(input: unknown): Promise<PlanActionResult> {
  const parsed = addLeftoverInput.safeParse(input);
  if (!parsed.success) return { error: "Pick a leftover and a portion count." };

  const user = await context();
  if (!user) return { error: "You are signed out." };

  const db = getDb();
  const [batch] = await db
    .select()
    .from(leftovers)
    .where(and(eq(leftovers.id, parsed.data.leftoverId), eq(leftovers.userId, user.id)))
    .limit(1);
  if (!batch) return { error: "That leftover is gone." };
  if (batch.portions < parsed.data.portions) {
    return { error: `Only ${batch.portions} portion(s) left.` };
  }

  const planId = await ensurePlan(user.id, parsed.data.week);

  await db.transaction(async (tx) => {
    await tx
      .insert(mealPlanEntries)
      .values({
        planId,
        day: parsed.data.day,
        slot: parsed.data.slot,
        kind: "leftover",
        leftoverId: batch.id,
        portions: parsed.data.portions,
        status: "planned",
      })
      .onConflictDoUpdate({
        target: [mealPlanEntries.planId, mealPlanEntries.day, mealPlanEntries.slot],
        set: {
          kind: "leftover",
          recipeId: null,
          leftoverId: batch.id,
          portions: parsed.data.portions,
          status: "planned",
          cookEventId: null,
        },
      });

    const remaining = batch.portions - parsed.data.portions;
    await tx
      .update(leftovers)
      .set({ portions: remaining, status: remaining <= 0 ? "reserved" : "available" })
      .where(eq(leftovers.id, batch.id));
  });

  revalidatePath(`/plan/${parsed.data.week}`);
  return { message: `${batch.label} set aside.` };
}

export async function removePlanEntry(entryId: string): Promise<PlanActionResult> {
  const user = await context();
  if (!user) return { error: "You are signed out." };

  const db = getDb();
  const [row] = await db
    .select({
      id: mealPlanEntries.id,
      kind: mealPlanEntries.kind,
      leftoverId: mealPlanEntries.leftoverId,
      portions: mealPlanEntries.portions,
      week: mealPlans.weekStart,
    })
    .from(mealPlanEntries)
    .innerJoin(mealPlans, eq(mealPlanEntries.planId, mealPlans.id))
    .where(and(eq(mealPlanEntries.id, entryId), eq(mealPlans.userId, user.id)))
    .limit(1);
  if (!row) return { error: "That entry is gone." };

  await db.transaction(async (tx) => {
    if (row.kind === "leftover" && row.leftoverId) {
      const [batch] = await tx
        .select({ portions: leftovers.portions })
        .from(leftovers)
        .where(eq(leftovers.id, row.leftoverId))
        .limit(1);
      if (batch) {
        await tx
          .update(leftovers)
          .set({ portions: batch.portions + row.portions, status: "available" })
          .where(eq(leftovers.id, row.leftoverId));
      }
    }
    await tx.delete(mealPlanEntries).where(eq(mealPlanEntries.id, entryId));
  });

  revalidatePath(`/plan/${row.week}`);
  return { message: "Removed." };
}
