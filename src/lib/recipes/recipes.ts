import type { SupabaseClient } from "@supabase/supabase-js";
import { ALLERGEN_TAGS } from "./types";
import type {
  InconsistencyReason,
  Recipe,
  RecipeCookability,
  RecipeInconsistency,
  RecipeLine,
  RecipeLinePantryStatus,
  RecipeLineStatus,
  RecipeLineSubstitute,
  RecipeLineSubstituteWithIngredient,
  RecipeLineWithDetails,
  RecipeWithLines,
} from "./types";

/**
 * Data access for Recipes (#7) — recipes, tags, lines, per-line
 * Substitutes and Essential flags. All the interesting logic (amount/unit
 * validation, Inconsistency detection, Cookable derivation, Alias
 * creation on resolution) lives in the `create_recipe_line`,
 * `update_recipe_line`, `resolve_recipe_line`, `reorder_recipe_lines` RPCs
 * and the `recipe_line_inconsistencies` / `recipe_status` /
 * `recipe_cookability` views; this module is thin wrappers plus the reads
 * the Recipes screens need, mirroring src/lib/ingredients/registry.ts and
 * src/lib/pantry/pantry.ts.
 *
 * Each function takes the Supabase client as a parameter rather than
 * constructing one, so callers can pass a browser client from a Client
 * Component and tests can pass a mock without reaching into module
 * internals.
 */

type Row = Record<string, unknown>;

function toRecipe(row: Row): Recipe {
  return {
    id: row.id as string,
    name: row.name as string,
    servings: Number(row.servings),
    maxMultiplier: Number(row.max_multiplier),
    rating: row.rating === null || row.rating === undefined ? null : Number(row.rating),
    prepMinutes:
      row.prep_minutes === null || row.prep_minutes === undefined
        ? null
        : Number(row.prep_minutes),
    cookMinutes:
      row.cook_minutes === null || row.cook_minutes === undefined
        ? null
        : Number(row.cook_minutes),
    source: (row.source as string | null) ?? null,
    sourceKey: (row.source_key as string | null) ?? null,
    status: row.status as Recipe["status"],
    steps: (row.steps as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

function toRecipeLine(row: Row): RecipeLine {
  return {
    id: row.id as string,
    recipeId: row.recipe_id as string,
    ingredientId: (row.ingredient_id as string | null) ?? null,
    rawName: (row.raw_name as string | null) ?? null,
    amount: row.amount === null || row.amount === undefined ? null : Number(row.amount),
    unit: (row.unit as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    isEssential: row.is_essential as boolean,
    position: Number(row.position),
    createdAt: row.created_at as string,
  };
}

function toRecipeLineSubstitute(row: Row): RecipeLineSubstitute {
  return {
    id: row.id as string,
    recipeLineId: row.recipe_line_id as string,
    ingredientId: row.ingredient_id as string,
    createdAt: row.created_at as string,
  };
}

function toInconsistency(row: Row): RecipeInconsistency {
  return {
    recipeLineId: row.recipe_line_id as string,
    recipeId: row.recipe_id as string,
    reason: row.reason as InconsistencyReason,
    lineLabel: row.line_label as string,
  };
}

function toLinePantryStatus(row: Row): RecipeLinePantryStatus {
  return {
    recipeLineId: row.recipe_line_id as string,
    recipeId: row.recipe_id as string,
    ingredientId: (row.ingredient_id as string | null) ?? null,
    isEssential: row.is_essential as boolean,
    status: row.status as RecipeLineStatus,
  };
}

function toCookability(row: Row): RecipeCookability {
  return {
    recipeId: row.recipe_id as string,
    name: row.name as string,
    isCookable: row.is_cookable as boolean,
  };
}

function errorMessage(error: { message: string } | null, fallback: string): string {
  return error?.message ?? fallback;
}

/**
 * A tag is an Allergen Flag when it matches the known vocabulary in
 * ALLERGEN_TAGS, case-insensitively. Everything else in `recipe_tags` is
 * an ordinary tag (cuisine, meal type) — the distinction is purely
 * display logic, not stored anywhere.
 */
export function allergenFlagsFromTags(tags: string[]): string[] {
  const known = new Set<string>(ALLERGEN_TAGS.map((tag) => tag.toLowerCase()));
  return tags.filter((tag) => known.has(tag.trim().toLowerCase()));
}

// --- Recipes ---------------------------------------------------------------

export async function listRecipes(client: SupabaseClient): Promise<Recipe[]> {
  const { data, error } = await client.from("recipes").select("*").order("name", { ascending: true });

  if (error) {
    throw new Error(errorMessage(error, "Failed to load Recipes"));
  }

  return (data ?? []).map(toRecipe);
}

export async function createRecipe(
  client: SupabaseClient,
  input: {
    name: string;
    servings: number;
    maxMultiplier?: number;
    prepMinutes?: number | null;
    cookMinutes?: number | null;
    source?: string | null;
    steps?: string | null;
  }
): Promise<Recipe> {
  const { data, error } = await client
    .from("recipes")
    .insert({
      name: input.name,
      servings: input.servings,
      max_multiplier: input.maxMultiplier ?? 1,
      prep_minutes: input.prepMinutes ?? null,
      cook_minutes: input.cookMinutes ?? null,
      source: input.source ?? null,
      steps: input.steps ?? null,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(errorMessage(error, "Failed to create Recipe"));
  }

  return toRecipe(data);
}

export async function updateRecipe(
  client: SupabaseClient,
  id: string,
  input: {
    name?: string;
    servings?: number;
    maxMultiplier?: number;
    prepMinutes?: number | null;
    cookMinutes?: number | null;
    source?: string | null;
    steps?: string | null;
  }
): Promise<Recipe> {
  const patch: Row = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.servings !== undefined) patch.servings = input.servings;
  if (input.maxMultiplier !== undefined) patch.max_multiplier = input.maxMultiplier;
  if (input.prepMinutes !== undefined) patch.prep_minutes = input.prepMinutes;
  if (input.cookMinutes !== undefined) patch.cook_minutes = input.cookMinutes;
  if (input.source !== undefined) patch.source = input.source;
  if (input.steps !== undefined) patch.steps = input.steps;

  const { data, error } = await client
    .from("recipes")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(errorMessage(error, "Failed to update Recipe"));
  }

  return toRecipe(data);
}

/** Sets a Recipe's rating (1-5), settable at any time, independent of cooking it. */
export async function rateRecipe(
  client: SupabaseClient,
  id: string,
  rating: number | null
): Promise<Recipe> {
  const { data, error } = await client
    .from("recipes")
    .update({ rating })
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(errorMessage(error, "Failed to rate Recipe"));
  }

  return toRecipe(data);
}

export async function deleteRecipe(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from("recipes").delete().eq("id", id);

  if (error) {
    throw new Error(errorMessage(error, "Failed to delete Recipe"));
  }
}

// --- Tags --------------------------------------------------------------

export async function listTags(client: SupabaseClient, recipeId: string): Promise<string[]> {
  const { data, error } = await client
    .from("recipe_tags")
    .select("tag")
    .eq("recipe_id", recipeId)
    .order("tag", { ascending: true });

  if (error) {
    throw new Error(errorMessage(error, "Failed to load Tags"));
  }

  return (data ?? []).map((row: Row) => row.tag as string);
}

export async function addTag(client: SupabaseClient, recipeId: string, tag: string): Promise<void> {
  const { error } = await client.from("recipe_tags").insert({ recipe_id: recipeId, tag });

  if (error) {
    throw new Error(errorMessage(error, "Failed to add Tag"));
  }
}

export async function removeTag(client: SupabaseClient, recipeId: string, tag: string): Promise<void> {
  const { error } = await client
    .from("recipe_tags")
    .delete()
    .eq("recipe_id", recipeId)
    .eq("tag", tag);

  if (error) {
    throw new Error(errorMessage(error, "Failed to remove Tag"));
  }
}

// --- Recipe Lines --------------------------------------------------------

export async function listLines(client: SupabaseClient, recipeId: string): Promise<RecipeLine[]> {
  const { data, error } = await client
    .from("recipe_lines")
    .select("*")
    .eq("recipe_id", recipeId)
    .order("position", { ascending: true });

  if (error) {
    throw new Error(errorMessage(error, "Failed to load Recipe Lines"));
  }

  return (data ?? []).map(toRecipeLine);
}

/**
 * Appends a Recipe Line via the `create_recipe_line` RPC. Amount/unit are
 * validated against the named Ingredient there — a non-convertible unit
 * or a missing quantity on an Auto-Depleted Ingredient throws rather than
 * being stored. Pass `ingredientId: null` with a `rawName` for an
 * Unresolved Ingredient line.
 */
export async function addLine(
  client: SupabaseClient,
  input: {
    recipeId: string;
    ingredientId: string | null;
    rawName?: string | null;
    amount?: number | null;
    unit?: string | null;
    note?: string | null;
    isEssential?: boolean;
  }
): Promise<RecipeLine> {
  const { data, error } = await client.rpc("create_recipe_line", {
    p_recipe_id: input.recipeId,
    p_ingredient_id: input.ingredientId,
    p_raw_name: input.rawName ?? null,
    p_amount: input.amount ?? null,
    p_unit: input.unit ?? null,
    p_note: input.note ?? null,
    p_is_essential: input.isEssential ?? false,
  });

  if (error) {
    throw new Error(errorMessage(error, "Failed to add Recipe Line"));
  }

  return toRecipeLine(data as Row);
}

/** Edits a Recipe Line in place via `update_recipe_line`, re-running the same validation as addLine. */
export async function updateLine(
  client: SupabaseClient,
  id: string,
  input: {
    ingredientId: string | null;
    rawName?: string | null;
    amount?: number | null;
    unit?: string | null;
    note?: string | null;
    isEssential?: boolean;
  }
): Promise<RecipeLine> {
  const { data, error } = await client.rpc("update_recipe_line", {
    p_id: id,
    p_ingredient_id: input.ingredientId,
    p_raw_name: input.rawName ?? null,
    p_amount: input.amount ?? null,
    p_unit: input.unit ?? null,
    p_note: input.note ?? null,
    p_is_essential: input.isEssential ?? false,
  });

  if (error) {
    throw new Error(errorMessage(error, "Failed to update Recipe Line"));
  }

  return toRecipeLine(data as Row);
}

export async function removeLine(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from("recipe_lines").delete().eq("id", id);

  if (error) {
    throw new Error(errorMessage(error, "Failed to remove Recipe Line"));
  }
}

/** Reassigns display order for a full set of a Recipe's Lines via `reorder_recipe_lines`. */
export async function reorderLines(
  client: SupabaseClient,
  recipeId: string,
  lineIds: string[]
): Promise<void> {
  const { error } = await client.rpc("reorder_recipe_lines", {
    p_recipe_id: recipeId,
    p_line_ids: lineIds,
  });

  if (error) {
    throw new Error(errorMessage(error, "Failed to reorder Recipe Lines"));
  }
}

/**
 * Maps an Unresolved Recipe Line's raw_name to an existing Ingredient via
 * `resolve_recipe_line`. When `createAlias` (default true), the mapping
 * is remembered as an Alias so the same free text resolves automatically
 * next time — the only way an Unresolved Ingredient becomes resolved.
 */
export async function resolveLine(
  client: SupabaseClient,
  lineId: string,
  ingredientId: string,
  createAlias = true
): Promise<RecipeLine> {
  const { data, error } = await client.rpc("resolve_recipe_line", {
    p_line_id: lineId,
    p_ingredient_id: ingredientId,
    p_create_alias: createAlias,
  });

  if (error) {
    throw new Error(errorMessage(error, "Failed to resolve Recipe Line"));
  }

  return toRecipeLine(data as Row);
}

// --- Substitutes ---------------------------------------------------------

export async function listSubstitutes(
  client: SupabaseClient,
  recipeLineId: string
): Promise<RecipeLineSubstituteWithIngredient[]> {
  const byLine = await listSubstitutesByLine(client, [recipeLineId]);
  return byLine.get(recipeLineId) ?? [];
}

/**
 * Every Substitute for a set of Recipe Lines in one read, grouped by line.
 * The Recipe screen renders every line at once, so asking per line would
 * cost a round trip per Ingredient on a phone connection.
 */
async function listSubstitutesByLine(
  client: SupabaseClient,
  recipeLineIds: string[]
): Promise<Map<string, RecipeLineSubstituteWithIngredient[]>> {
  const byLine = new Map<string, RecipeLineSubstituteWithIngredient[]>();

  if (recipeLineIds.length === 0) {
    return byLine;
  }

  const { data, error } = await client
    .from("recipe_line_substitutes")
    .select("id, recipe_line_id, ingredient_id, created_at, ingredients(name)")
    .in("recipe_line_id", recipeLineIds);

  if (error) {
    throw new Error(errorMessage(error, "Failed to load Substitutes"));
  }

  for (const row of (data ?? []) as Row[]) {
    const substitute: RecipeLineSubstituteWithIngredient = {
      ...toRecipeLineSubstitute(row),
      ingredientName: (row.ingredients as { name: string } | null)?.name ?? "",
    };
    const existing = byLine.get(substitute.recipeLineId);
    if (existing) {
      existing.push(substitute);
    } else {
      byLine.set(substitute.recipeLineId, [substitute]);
    }
  }

  return byLine;
}

/**
 * Adds a Substitute acceptable for one specific Recipe Line. Rejected by
 * the database when the line is_essential — Essential lines never carry
 * Substitutes, so no code here needs to re-check that itself.
 */
export async function addSubstitute(
  client: SupabaseClient,
  recipeLineId: string,
  ingredientId: string
): Promise<RecipeLineSubstitute> {
  const { data, error } = await client
    .from("recipe_line_substitutes")
    .insert({ recipe_line_id: recipeLineId, ingredient_id: ingredientId })
    .select("*")
    .single();

  if (error) {
    throw new Error(errorMessage(error, "Failed to add Substitute"));
  }

  return toRecipeLineSubstitute(data);
}

export async function removeSubstitute(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from("recipe_line_substitutes").delete().eq("id", id);

  if (error) {
    throw new Error(errorMessage(error, "Failed to remove Substitute"));
  }
}

// --- Inconsistencies, Pantry status, Cookable -----------------------------

export async function listInconsistencies(
  client: SupabaseClient,
  recipeId: string
): Promise<RecipeInconsistency[]> {
  const { data, error } = await client
    .from("recipe_line_inconsistencies")
    .select("*")
    .eq("recipe_id", recipeId);

  if (error) {
    throw new Error(errorMessage(error, "Failed to load Inconsistencies"));
  }

  return (data ?? []).map(toInconsistency);
}

export async function listLineStatuses(
  client: SupabaseClient,
  recipeId: string
): Promise<RecipeLinePantryStatus[]> {
  const { data, error } = await client
    .from("recipe_status")
    .select("*")
    .eq("recipe_id", recipeId);

  if (error) {
    throw new Error(errorMessage(error, "Failed to load Recipe Line status"));
  }

  return (data ?? []).map(toLinePantryStatus);
}

export async function getCookability(
  client: SupabaseClient,
  recipeId: string
): Promise<RecipeCookability | null> {
  const { data, error } = await client
    .from("recipe_cookability")
    .select("*")
    .eq("recipe_id", recipeId)
    .maybeSingle();

  if (error) {
    throw new Error(errorMessage(error, "Failed to load Cookable status"));
  }

  return data ? toCookability(data) : null;
}

export async function listCookability(client: SupabaseClient): Promise<RecipeCookability[]> {
  const { data, error } = await client.from("recipe_cookability").select("*");

  if (error) {
    throw new Error(errorMessage(error, "Failed to load Cookable status"));
  }

  return (data ?? []).map(toCookability);
}

/**
 * The Recipe detail/reading screen's one grouped read: the Recipe, its
 * Tags, and every Line with enough Ingredient and Substitute context to
 * render without further round trips.
 */
export async function getRecipeWithLines(
  client: SupabaseClient,
  recipeId: string
): Promise<RecipeWithLines | null> {
  const { data: recipeRow, error: recipeError } = await client
    .from("recipes")
    .select("*")
    .eq("id", recipeId)
    .maybeSingle();

  if (recipeError) {
    throw new Error(errorMessage(recipeError, "Failed to load Recipe"));
  }

  if (!recipeRow) {
    return null;
  }

  const [tags, lineRows] = await Promise.all([
    listTags(client, recipeId),
    client
      .from("recipe_lines")
      .select("*, ingredients(name, stock_unit, is_hand_depleted)")
      .eq("recipe_id", recipeId)
      .order("position", { ascending: true })
      .then(({ data, error }: { data: Row[] | null; error: { message: string } | null }) => {
        if (error) {
          throw new Error(errorMessage(error, "Failed to load Recipe Lines"));
        }
        return data ?? [];
      }),
  ]);

  const lines: RecipeLineWithDetails[] = [];
  const substitutesByLine = await listSubstitutesByLine(
    client,
    lineRows.map((row) => row.id as string)
  );

  for (const row of lineRows) {
    const ingredient = row.ingredients as
      | { name: string; stock_unit: string; is_hand_depleted: boolean }
      | null;
    lines.push({
      ...toRecipeLine(row),
      ingredientName: ingredient?.name ?? null,
      stockUnit: ingredient?.stock_unit ?? null,
      isHandDepleted: ingredient?.is_hand_depleted ?? null,
      substitutes: substitutesByLine.get(row.id as string) ?? [],
    });
  }

  return {
    ...toRecipe(recipeRow),
    tags,
    lines,
  };
}
