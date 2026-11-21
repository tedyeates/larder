import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { leftovers, mealPlanEntries, mealPlans, recipes } from "@/db/schema";
import { startOfWeek, todayIso } from "@/domain/dates";

export type Slot = "lunch" | "dinner";
export const SLOTS: readonly Slot[] = ["lunch", "dinner"];

export type EntryStatus = "planned" | "cooked" | "eaten" | "skipped";

export interface PlanEntryView {
  readonly id: string;
  readonly day: string;
  readonly slot: Slot;
  readonly kind: "recipe" | "leftover";
  readonly recipeId: string | null;
  readonly leftoverId: string | null;
  readonly title: string;
  readonly portions: number;
  readonly status: EntryStatus;
  readonly createdBy: "manual" | "agent";
  /** Planning instructions carried by the recipe, for agents. */
  readonly aiNotes?: string | null;
}

export interface WeekView {
  readonly week: string;
  readonly planId: string | null;
  readonly status: "draft" | "active" | "archived";
  readonly entries: readonly PlanEntryView[];
}

export function currentWeek(): string {
  return startOfWeek(todayIso());
}

export async function loadWeek(userId: string, week: string): Promise<WeekView> {
  const db = getDb();
  const [plan] = await db
    .select()
    .from(mealPlans)
    .where(and(eq(mealPlans.userId, userId), eq(mealPlans.weekStart, week)))
    .limit(1);

  if (!plan) return { week, planId: null, status: "active", entries: [] };

  const rows = await db
    .select({
      id: mealPlanEntries.id,
      day: mealPlanEntries.day,
      slot: mealPlanEntries.slot,
      kind: mealPlanEntries.kind,
      recipeId: mealPlanEntries.recipeId,
      leftoverId: mealPlanEntries.leftoverId,
      portions: mealPlanEntries.portions,
      status: mealPlanEntries.status,
      createdBy: mealPlanEntries.createdBy,
      recipeTitle: recipes.title,
      recipeNotes: recipes.aiNotes,
      leftoverLabel: leftovers.label,
      leftoverRecipeId: leftovers.recipeId,
    })
    .from(mealPlanEntries)
    .leftJoin(recipes, eq(mealPlanEntries.recipeId, recipes.id))
    .leftJoin(leftovers, eq(mealPlanEntries.leftoverId, leftovers.id))
    .where(eq(mealPlanEntries.planId, plan.id))
    .orderBy(mealPlanEntries.day, mealPlanEntries.slot, mealPlanEntries.sortOrder);

  return {
    week,
    planId: plan.id,
    status: plan.status,
    entries: rows.map<PlanEntryView>((row) => ({
      id: row.id,
      day: row.day,
      slot: row.slot,
      kind: row.kind,
      recipeId: row.recipeId ?? row.leftoverRecipeId,
      leftoverId: row.leftoverId,
      title: row.recipeTitle ?? row.leftoverLabel ?? "Meal",
      portions: row.portions,
      status: row.status,
      createdBy: row.createdBy,
      aiNotes: row.recipeNotes,
    })),
  };
}

export async function ensurePlan(userId: string, week: string): Promise<string> {
  const db = getDb();
  const [existing] = await db
    .select({ id: mealPlans.id })
    .from(mealPlans)
    .where(and(eq(mealPlans.userId, userId), eq(mealPlans.weekStart, week)))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(mealPlans)
    .values({ userId, weekStart: week, status: "active", createdBy: "manual" })
    .returning({ id: mealPlans.id });
  if (!created) throw new Error("Could not create the week");
  return created.id;
}

export interface RecipeOption {
  readonly id: string;
  readonly title: string;
  readonly servings: number;
}

export async function listRecipeOptions(userId: string): Promise<RecipeOption[]> {
  return getDb()
    .select({ id: recipes.id, title: recipes.title, servings: recipes.servings })
    .from(recipes)
    .where(eq(recipes.userId, userId))
    .orderBy(recipes.title);
}

export interface LeftoverOption {
  readonly id: string;
  readonly label: string;
  readonly portions: number;
  readonly bestBefore: string | null;
}

export async function listLeftovers(userId: string): Promise<LeftoverOption[]> {
  return getDb()
    .select({
      id: leftovers.id,
      label: leftovers.label,
      portions: leftovers.portions,
      bestBefore: leftovers.bestBefore,
    })
    .from(leftovers)
    .where(and(eq(leftovers.userId, userId), eq(leftovers.status, "available")))
    .orderBy(leftovers.storedAt);
}

export function weekDays(week: string): string[] {
  const base = new Date(`${week}T00:00:00Z`).getTime();
  return Array.from({ length: 7 }, (_, index) =>
    new Date(base + index * 86_400_000).toISOString().slice(0, 10),
  );
}

export interface PlannedCook {
  readonly recipeId: string;
  readonly title: string;
  readonly day: string;
  /** Portions this week intends to cook. */
  readonly portions: number;
  /** How many cooks are planned; one portion of each is eaten on the night. */
  readonly cooks: number;
  /** Portions realistically available to earmark: portions minus one per cook. */
  readonly capacity: number;
  /** Portions already earmarked as planned leftovers. */
  readonly reserved: number;
}

/**
 * The cooks on this week's plan, and how much of each is already promised to a
 * future leftover slot. Cooking twice stacks: two two-portion dinners leave two
 * portions once one is eaten on each night.
 */
export function derivePlannedCooks(entries: readonly PlanEntryView[]): PlannedCook[] {
  const cooks = new Map<
    string,
    { recipeId: string; title: string; day: string; portions: number; cooks: number }
  >();

  for (const entry of entries) {
    if (entry.kind !== "recipe" || entry.status !== "planned" || entry.recipeId === null) continue;
    const existing = cooks.get(entry.recipeId);
    if (existing) {
      cooks.set(entry.recipeId, {
        ...existing,
        portions: existing.portions + entry.portions,
        cooks: existing.cooks + 1,
      });
    } else {
      cooks.set(entry.recipeId, {
        recipeId: entry.recipeId,
        title: entry.title,
        day: entry.day,
        portions: entry.portions,
        cooks: 1,
      });
    }
  }

  const reserved = new Map<string, number>();
  for (const entry of entries) {
    if (
      entry.kind !== "leftover" ||
      entry.leftoverId !== null ||
      entry.recipeId === null ||
      entry.status !== "planned"
    ) {
      continue;
    }
    reserved.set(entry.recipeId, (reserved.get(entry.recipeId) ?? 0) + entry.portions);
  }

  return [...cooks.values()].map((cook) => ({
    ...cook,
    capacity: Math.max(0, cook.portions - cook.cooks),
    reserved: reserved.get(cook.recipeId) ?? 0,
  }));
}

export interface PlanSummary {
  /** Actual cooking entries, not leftover meals. */
  readonly cooks: number;
  /** Portions cooked but not yet earmarked as leftovers. */
  readonly sparePortions: number;
  /** Meals planned to eat leftovers, whether cooked yet or not. */
  readonly leftoverMeals: number;
}

/** Split the plan into "what I cook" and "what I reheat" for the header. */
export function summarizePlan(entries: readonly PlanEntryView[]): PlanSummary {
  const cooks = derivePlannedCooks(entries);
  return {
    cooks: cooks.reduce((total, cook) => total + cook.cooks, 0),
    sparePortions: cooks.reduce(
      (total, cook) => total + Math.max(0, cook.capacity - cook.reserved),
      0,
    ),
    leftoverMeals: entries.filter(
      (entry) => entry.kind === "leftover" && entry.status === "planned",
    ).length,
  };
}
