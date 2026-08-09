import type { SupabaseClient } from "@supabase/supabase-js";
import type { CookPreview, CookSubstitutionChoice } from "@/lib/meals";
import type { MealPlanSlot, MealPlanLineStatus, MealTime } from "./types";

type Row = Record<string, unknown>;

function errorMessage(error: { message: string } | null, fallback: string): string {
  return error?.message ?? fallback;
}

function toSlot(row: Row): MealPlanSlot {
  return {
    id: row.id as string,
    slotDate: row.slot_date as string,
    mealTime: row.meal_time as MealTime,
    recipeId: (row.recipe_id as string | null) ?? null,
    recipeName: (row.recipe_name as string | null) ?? null,
    label: (row.label as string | null) ?? null,
    isCook: Boolean(row.is_cook),
    cookMultiplier: Number(row.cook_multiplier),
    cookId: (row.cook_id as string | null) ?? null,
    isCookable: row.is_cookable === null || row.is_cookable === undefined ? null : Boolean(row.is_cookable),
    shortfall: Boolean(row.shortfall),
    lineStatuses: ((row.line_statuses as Row[] | null) ?? []).map((line) => ({
      recipeLineId: line.recipe_line_id as string,
      ingredientName: line.ingredient_name as string,
      status: line.status as MealPlanLineStatus["status"],
    })),
  };
}

function toCookPreview(row: Row): CookPreview {
  return {
    recipeId: row.recipe_id as string,
    recipeName: row.recipe_name as string,
    multiplier: Number(row.multiplier),
    portionsProduced: Number(row.portions_produced),
    lines: ((row.lines as Row[] | undefined) ?? []).map((line) => ({
      recipeLineId: line.recipe_line_id as string,
      ingredientId: (line.ingredient_id as string | null) ?? null,
      ingredientName: line.ingredient_name as string,
      stockUnit: (line.stock_unit as string | null) ?? null,
      requested: Number(line.requested),
      availableQuantity: Number(line.available_quantity),
      willDeplete: Number(line.will_deplete),
      shortfall: Number(line.shortfall),
      issue: (line.issue as string | null) ?? null,
      substituteIngredientId: (line.substitute_ingredient_id as string | null) ?? null,
      substitutes: ((line.substitutes as Row[] | undefined) ?? []).map((substitute) => ({
        ingredientId: substitute.ingredient_id as string,
        ingredientName: substitute.ingredient_name as string,
        availableQuantity: Number(substitute.available_quantity),
      })),
    })),
    ...(row.cook_id ? { cookId: row.cook_id as string } : {}),
    ...(row.portion_batch_id ? { portionBatchId: row.portion_batch_id as string } : {}),
  };
}

function rpcChoices(choices: CookSubstitutionChoice[]): Row[] {
  return choices.map((choice) => ({ recipe_line_id: choice.recipeLineId, substitute_ingredient_id: choice.substituteIngredientId }));
}

export async function listMealPlanSlots(client: SupabaseClient, startDate: string, endDate: string): Promise<MealPlanSlot[]> {
  const { data, error } = await client
    .from("meal_plan_slot_status")
    .select("*")
    .gte("slot_date", startDate)
    .lte("slot_date", endDate)
    .order("slot_date", { ascending: true })
    .order("meal_time", { ascending: true });
  if (error) throw new Error(errorMessage(error, "Failed to load Meal Plan"));
  return ((data ?? []) as Row[]).map(toSlot);
}

export async function saveMealPlanSlot(
  client: SupabaseClient,
  input: { slotDate: string; mealTime: MealTime; recipeId?: string; label?: string; isCook: boolean; cookMultiplier: number }
): Promise<void> {
  const { error } = await client.rpc("set_meal_plan_slot", {
    p_slot_date: input.slotDate,
    p_meal_time: input.mealTime,
    p_recipe_id: input.recipeId ?? null,
    p_label: input.label ?? null,
    p_is_cook: input.isCook,
    p_cook_multiplier: input.cookMultiplier,
  });
  if (error) throw new Error(errorMessage(error, "Failed to save Meal Slot"));
}

export async function moveMealPlanSlot(client: SupabaseClient, id: string, slotDate: string, mealTime: MealTime): Promise<void> {
  const { error } = await client.rpc("move_meal_plan_slot", { p_slot_id: id, p_slot_date: slotDate, p_meal_time: mealTime });
  if (error) throw new Error(errorMessage(error, "Failed to move Meal Slot"));
}

export async function clearMealPlanSlot(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.rpc("clear_meal_plan_slot", { p_slot_id: id });
  if (error) throw new Error(errorMessage(error, "Failed to clear Meal Slot"));
}

export async function topUpMealPlanSlot(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.rpc("top_up_meal_plan_slot", { p_slot_id: id });
  if (error) throw new Error(errorMessage(error, "Failed to Top-Up Recipe"));
}

export async function previewPlanCook(client: SupabaseClient, id: string, substitutions: CookSubstitutionChoice[]): Promise<CookPreview> {
  const { data, error } = await client.rpc("preview_meal_plan_cook", { p_slot_id: id, p_substitutions: rpcChoices(substitutions) });
  if (error) throw new Error(errorMessage(error, "Failed to preview Cook"));
  return toCookPreview(data as Row);
}

export async function commitPlanCook(client: SupabaseClient, id: string, substitutions: CookSubstitutionChoice[]): Promise<CookPreview> {
  const { data, error } = await client.rpc("commit_meal_plan_cook", { p_slot_id: id, p_substitutions: rpcChoices(substitutions) });
  if (error) throw new Error(errorMessage(error, "Failed to cook Meal Slot"));
  return toCookPreview(data as Row);
}

export async function eatMealPlanSlot(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.rpc("eat_meal_plan_slot", { p_slot_id: id });
  if (error) throw new Error(errorMessage(error, "Failed to mark Meal Slot eaten"));
}

export async function ateOutMealPlanSlot(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.rpc("ate_out_meal_plan_slot", { p_slot_id: id });
  if (error) throw new Error(errorMessage(error, "Failed to mark Meal Slot Ate Out"));
}
