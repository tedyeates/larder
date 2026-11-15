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
}

export interface WeekView {
  readonly week: string;
  readonly planId: string | null;
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

  if (!plan) return { week, planId: null, entries: [] };

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
      recipeTitle: recipes.title,
      leftoverLabel: leftovers.label,
    })
    .from(mealPlanEntries)
    .leftJoin(recipes, eq(mealPlanEntries.recipeId, recipes.id))
    .leftJoin(leftovers, eq(mealPlanEntries.leftoverId, leftovers.id))
    .where(eq(mealPlanEntries.planId, plan.id))
    .orderBy(mealPlanEntries.day, mealPlanEntries.slot);

  return {
    week,
    planId: plan.id,
    entries: rows.map<PlanEntryView>((row) => ({
      id: row.id,
      day: row.day,
      slot: row.slot,
      kind: row.kind,
      recipeId: row.recipeId,
      leftoverId: row.leftoverId,
      title: row.recipeTitle ?? row.leftoverLabel ?? "Meal",
      portions: row.portions,
      status: row.status,
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
