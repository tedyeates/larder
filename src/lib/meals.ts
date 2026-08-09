import type { SupabaseClient } from "@supabase/supabase-js";
import type { StorageLocation } from "@/lib/pantry/types";

type Row = Record<string, unknown>;

export type CookSubstitutionChoice = {
  recipeLineId: string;
  substituteIngredientId: string;
};

export type CookPreviewLine = {
  recipeLineId: string;
  ingredientId: string | null;
  ingredientName: string;
  stockUnit: string | null;
  requested: number;
  availableQuantity: number;
  willDeplete: number;
  shortfall: number;
  issue: string | null;
  substituteIngredientId: string | null;
  substitutes: { ingredientId: string; ingredientName: string; availableQuantity: number }[];
};

export type CookPreview = {
  recipeId: string;
  recipeName: string;
  multiplier: number;
  portionsProduced: number;
  lines: CookPreviewLine[];
  cookId?: string;
  portionBatchId?: string;
};

export type PortionBatch = {
  id: string;
  recipeId: string | null;
  label: string | null;
  portionsRemaining: number;
  storageLocation: StorageLocation;
  cookedOn: string;
  createdAt: string;
};

export type MealStockRow = {
  recipeId: string | null;
  label: string | null;
  displayName: string;
  totalPortions: number;
  oldestCookedOn: string;
  batchCount: number;
};

function errorMessage(error: { message: string } | null, fallback: string): string {
  return error?.message ?? fallback;
}

function toPreviewLine(row: Row): CookPreviewLine {
  return {
    recipeLineId: row.recipe_line_id as string,
    ingredientId: (row.ingredient_id as string | null) ?? null,
    ingredientName: row.ingredient_name as string,
    stockUnit: (row.stock_unit as string | null) ?? null,
    requested: Number(row.requested),
    availableQuantity: Number(row.available_quantity),
    willDeplete: Number(row.will_deplete),
    shortfall: Number(row.shortfall),
    issue: (row.issue as string | null) ?? null,
    substituteIngredientId: (row.substitute_ingredient_id as string | null) ?? null,
    substitutes: ((row.substitutes as Row[] | undefined) ?? []).map((substitute) => ({
      ingredientId: substitute.ingredient_id as string,
      ingredientName: substitute.ingredient_name as string,
      availableQuantity: Number(substitute.available_quantity),
    })),
  };
}

function toPreview(row: Row): CookPreview {
  return {
    recipeId: row.recipe_id as string,
    recipeName: row.recipe_name as string,
    multiplier: Number(row.multiplier),
    portionsProduced: Number(row.portions_produced),
    lines: ((row.lines as Row[] | undefined) ?? []).map(toPreviewLine),
    ...(row.cook_id ? { cookId: row.cook_id as string } : {}),
    ...(row.portion_batch_id ? { portionBatchId: row.portion_batch_id as string } : {}),
  };
}

function toPortionBatch(row: Row): PortionBatch {
  return {
    id: row.id as string,
    recipeId: (row.recipe_id as string | null) ?? null,
    label: (row.label as string | null) ?? null,
    portionsRemaining: Number(row.portions_remaining),
    storageLocation: row.storage_location as StorageLocation,
    cookedOn: row.cooked_on as string,
    createdAt: row.created_at as string,
  };
}

function choicesForRpc(choices: CookSubstitutionChoice[]): Row[] {
  return choices.map((choice) => ({
    recipe_line_id: choice.recipeLineId,
    substitute_ingredient_id: choice.substituteIngredientId,
  }));
}

/** Shared Cook preview from Postgres — UI renders this data verbatim. */
export async function previewCook(
  client: SupabaseClient,
  input: { recipeId: string; multiplier: number; substitutions: CookSubstitutionChoice[] }
): Promise<CookPreview> {
  const { data, error } = await client.rpc("preview_cook", {
    p_recipe_id: input.recipeId,
    p_multiplier: input.multiplier,
    p_substitutions: choicesForRpc(input.substitutions),
  });
  if (error) throw new Error(errorMessage(error, "Failed to preview Cook"));
  return toPreview(data as Row);
}

/** Commits through the same Cook module that produced the confirmation warning. */
export async function commitCook(
  client: SupabaseClient,
  input: {
    recipeId: string;
    multiplier: number;
    substitutions: CookSubstitutionChoice[];
    cookedOn?: string;
  }
): Promise<CookPreview> {
  const { data, error } = await client.rpc("commit_cook", {
    p_recipe_id: input.recipeId,
    p_multiplier: input.multiplier,
    p_substitutions: choicesForRpc(input.substitutions),
    ...(input.cookedOn ? { p_cooked_on: input.cookedOn } : {}),
  });
  if (error) throw new Error(errorMessage(error, "Failed to cook Recipe"));
  return toPreview(data as Row);
}

/** Meal Stock grouped by Recipe, with count and age of its oldest Batch. */
export async function listMealStock(client: SupabaseClient): Promise<MealStockRow[]> {
  const { data, error } = await client
    .from("meal_stock")
    .select("*")
    .order("oldest_cooked_on", { ascending: true });
  if (error) throw new Error(errorMessage(error, "Failed to load Meal Stock"));
  return ((data ?? []) as Row[]).map((row) => ({
    recipeId: (row.recipe_id as string | null) ?? null,
    label: (row.label as string | null) ?? null,
    displayName: row.display_name as string,
    totalPortions: Number(row.total_portions),
    oldestCookedOn: row.oldest_cooked_on as string,
    batchCount: Number(row.batch_count),
  }));
}

export async function listPortionBatches(
  client: SupabaseClient,
  recipeId?: string
): Promise<PortionBatch[]> {
  let query = client.from("portion_batches").select("*").order("cooked_on", { ascending: true });
  if (recipeId) query = query.eq("recipe_id", recipeId);
  const { data, error } = await query;
  if (error) throw new Error(errorMessage(error, "Failed to load Portion Batches"));
  return ((data ?? []) as Row[]).map(toPortionBatch);
}

export async function addPortionBatch(
  client: SupabaseClient,
  input: {
    recipeId?: string;
    label?: string;
    portions: number;
    storageLocation?: StorageLocation;
    cookedOn?: string;
  }
): Promise<PortionBatch> {
  const { data, error } = await client.rpc("add_portion_batch", {
    p_recipe_id: input.recipeId ?? null,
    p_label: input.label ?? null,
    p_portions: input.portions,
    p_storage_location: input.storageLocation ?? "fridge",
    ...(input.cookedOn ? { p_cooked_on: input.cookedOn } : {}),
  });
  if (error) throw new Error(errorMessage(error, "Failed to add Portion Batch"));
  return toPortionBatch(data as Row);
}

export async function updatePortionBatch(
  client: SupabaseClient,
  id: string,
  input: { portionsRemaining?: number; storageLocation?: StorageLocation; cookedOn?: string; label?: string }
): Promise<PortionBatch> {
  const patch: Row = {};
  if (input.portionsRemaining !== undefined) patch.portions_remaining = input.portionsRemaining;
  if (input.storageLocation !== undefined) patch.storage_location = input.storageLocation;
  if (input.cookedOn !== undefined) patch.cooked_on = input.cookedOn;
  if (input.label !== undefined) patch.label = input.label;
  const { data, error } = await client
    .from("portion_batches")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(errorMessage(error, "Failed to update Portion Batch"));
  return toPortionBatch(data as Row);
}

export async function eatPortion(
  client: SupabaseClient,
  input: { portionBatchId?: string; recipeId?: string; occurredOn?: string; mealTime?: string; note?: string }
): Promise<void> {
  const { error } = await client.rpc("eat_portion", {
    p_portion_batch_id: input.portionBatchId ?? null,
    p_recipe_id: input.recipeId ?? null,
    ...(input.occurredOn ? { p_occurred_on: input.occurredOn } : {}),
    ...(input.mealTime ? { p_meal_time: input.mealTime } : {}),
    ...(input.note ? { p_note: input.note } : {}),
  });
  if (error) throw new Error(errorMessage(error, "Failed to eat Portion"));
}

export async function recordAteOut(
  client: SupabaseClient,
  input: { description: string; occurredOn?: string; mealTime?: string; note?: string }
): Promise<void> {
  const { error } = await client.rpc("record_ate_out", {
    p_description: input.description,
    ...(input.occurredOn ? { p_occurred_on: input.occurredOn } : {}),
    ...(input.mealTime ? { p_meal_time: input.mealTime } : {}),
    ...(input.note ? { p_note: input.note } : {}),
  });
  if (error) throw new Error(errorMessage(error, "Failed to record Ate Out"));
}
