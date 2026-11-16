"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import { leftovers, mealPlanEntries, mealPlans, recipes } from "@/db/schema";
import { daysBetween } from "@/domain/dates";
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

const plannedLeftoverInput = z.object({
  week: weekInput,
  day: weekInput,
  slot: slotInput,
  recipeId: z.uuid(),
  portions: z.coerce.number().positive().max(24),
});

/**
 * Reserve a future leftover slot against a cook that is already on the plan.
 * It deducts nothing yet, but it is bounded by that cook's portions, so you
 * cannot schedule five portions out of a two-portion dinner.
 */
export async function addPlannedLeftover(input: unknown): Promise<PlanActionResult> {
  const parsed = plannedLeftoverInput.safeParse(input);
  if (!parsed.success) return { error: "Pick a dish and a portion count." };

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

  const cooks = await db
    .select()
    .from(mealPlanEntries)
    .where(
      and(
        eq(mealPlanEntries.planId, planId),
        eq(mealPlanEntries.kind, "recipe"),
        eq(mealPlanEntries.recipeId, recipe.id),
      ),
    )
    .orderBy(mealPlanEntries.day);

  const usable = cooks.filter((cook) => cook.status !== "skipped");
  if (usable.length === 0) {
    return {
      error: `Add ${recipe.title} as a meal first — leftovers have to come from a cook.`,
    };
  }

  const firstDay = usable[0]?.day;
  if (firstDay !== undefined && daysBetween(firstDay, parsed.data.day) < 0) {
    return { error: "Leftovers can't be eaten before the dish is cooked." };
  }

  // One portion of each cook is eaten on the night; the rest can be earmarked.
  const capacity = usable.reduce((total, cook) => total + Math.max(0, cook.portions - 1), 0);

  const existing = await db
    .select()
    .from(mealPlanEntries)
    .where(
      and(
        eq(mealPlanEntries.planId, planId),
        eq(mealPlanEntries.kind, "leftover"),
        eq(mealPlanEntries.recipeId, recipe.id),
        eq(mealPlanEntries.status, "planned"),
        isNull(mealPlanEntries.leftoverId),
      ),
    );

  const alreadyPlanned = existing
    .filter((row) => !(row.day === parsed.data.day && row.slot === parsed.data.slot))
    .reduce((total, row) => total + row.portions, 0);

  const available = capacity - alreadyPlanned;
  if (parsed.data.portions > available) {
    return {
      error:
        available <= 0
          ? `Nothing spare from ${recipe.title} — one portion of each cook is eaten on the night.`
          : `Only ${available} portion(s) spare from ${recipe.title}.`,
    };
  }

  await db
    .insert(mealPlanEntries)
    .values({
      planId,
      day: parsed.data.day,
      slot: parsed.data.slot,
      kind: "leftover",
      recipeId: recipe.id,
      leftoverId: null,
      portions: parsed.data.portions,
      status: "planned",
    })
    .onConflictDoUpdate({
      target: [mealPlanEntries.planId, mealPlanEntries.day, mealPlanEntries.slot],
      set: {
        kind: "leftover",
        recipeId: recipe.id,
        leftoverId: null,
        portions: parsed.data.portions,
        status: "planned",
        cookEventId: null,
      },
    });

  revalidatePath(`/plan/${parsed.data.week}`);
  return { message: `${recipe.title} planned as leftovers.` };
}

export async function activatePlan(week: unknown): Promise<PlanActionResult> {
  const parsed = weekInput.safeParse(week);
  if (!parsed.success) return { error: "That week doesn't look right." };

  const user = await context();
  if (!user) return { error: "You are signed out." };

  const db = getDb();
  const [plan] = await db
    .select({ id: mealPlans.id })
    .from(mealPlans)
    .where(and(eq(mealPlans.userId, user.id), eq(mealPlans.weekStart, parsed.data)))
    .limit(1);
  if (!plan) return { error: "There's no plan for that week." };

  await db.update(mealPlans).set({ status: "active" }).where(eq(mealPlans.id, plan.id));
  revalidatePath(`/plan/${parsed.data}`);
  revalidatePath("/plan");
  return { message: "Plan activated." };
}

export async function discardDraft(week: unknown): Promise<PlanActionResult> {
  const parsed = weekInput.safeParse(week);
  if (!parsed.success) return { error: "That week doesn't look right." };

  const user = await context();
  if (!user) return { error: "You are signed out." };

  const db = getDb();
  const [plan] = await db
    .select({ id: mealPlans.id })
    .from(mealPlans)
    .where(and(eq(mealPlans.userId, user.id), eq(mealPlans.weekStart, parsed.data)))
    .limit(1);
  if (!plan) return { error: "There's no plan for that week." };

  await db.transaction(async (tx) => {
    await tx
      .delete(mealPlanEntries)
      .where(and(eq(mealPlanEntries.planId, plan.id), eq(mealPlanEntries.createdBy, "agent")));

    const [remaining] = await tx
      .select({ id: mealPlanEntries.id })
      .from(mealPlanEntries)
      .where(eq(mealPlanEntries.planId, plan.id))
      .limit(1);

    if (remaining) {
      await tx.update(mealPlans).set({ status: "active" }).where(eq(mealPlans.id, plan.id));
    } else {
      await tx.delete(mealPlans).where(eq(mealPlans.id, plan.id));
    }
  });

  revalidatePath(`/plan/${parsed.data}`);
  revalidatePath("/plan");
  return { message: "Draft discarded." };
}

export async function discardLeftover(leftoverId: string): Promise<PlanActionResult> {
  const user = await context();
  if (!user) return { error: "You are signed out." };
  const db = getDb();

  const [batch] = await db
    .select({ id: leftovers.id, status: leftovers.status })
    .from(leftovers)
    .where(and(eq(leftovers.id, leftoverId), eq(leftovers.userId, user.id)))
    .limit(1);
  if (!batch) return { error: "That leftover is gone." };
  if (batch.status !== "available") return { error: "That leftover is already spoken for." };

  const [used] = await db
    .select({ id: mealPlanEntries.id })
    .from(mealPlanEntries)
    .where(and(eq(mealPlanEntries.leftoverId, leftoverId), eq(mealPlanEntries.status, "planned")))
    .limit(1);
  if (used) return { error: "Remove the planned meal that uses it first." };

  await db.update(leftovers).set({ status: "discarded" }).where(eq(leftovers.id, leftoverId));
  revalidatePath("/plan");
  return { message: "Leftover discarded." };
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
