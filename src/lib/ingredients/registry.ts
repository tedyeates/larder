import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Ingredient,
  IngredientAlias,
  IngredientCandidate,
  ResolveResult,
  UnitConversion,
} from "./types";

/**
 * Data access for the Ingredient Registry. Thin wrappers around Supabase
 * table access and the two RPCs — `resolve_ingredient_name` and
 * `convert_to_stock_unit` — that own resolution and conversion. Nothing
 * outside this module should call those RPCs directly or re-implement
 * their logic; see docs/adr/0003-recipes-measure-in-stock-units.md.
 *
 * Each function takes the Supabase client as a parameter rather than
 * constructing one, so callers can pass a browser client from a Client
 * Component or a server client from a Server Action, and so tests can pass
 * a mock without reaching into module internals.
 */

type Row = Record<string, unknown>;

function toIngredient(row: Row): Ingredient {
  return {
    id: row.id as string,
    name: row.name as string,
    stockUnit: row.stock_unit as string,
    isHandDepleted: row.is_hand_depleted as boolean,
    lastPurchasedAmount:
      row.last_purchased_amount === null ? null : Number(row.last_purchased_amount),
    status: row.status as Ingredient["status"],
    createdAt: row.created_at as string,
  };
}

function toAlias(row: Row): IngredientAlias {
  return {
    id: row.id as string,
    ingredientId: row.ingredient_id as string,
    alias: row.alias as string,
    createdAt: row.created_at as string,
  };
}

function toUnitConversion(row: Row): UnitConversion {
  return {
    id: row.id as string,
    ingredientId: row.ingredient_id as string,
    fromUnit: row.from_unit as string,
    factorToStockUnit: Number(row.factor_to_stock_unit),
    createdAt: row.created_at as string,
  };
}

function errorMessage(error: { message: string } | null, fallback: string): string {
  return error?.message ?? fallback;
}

export async function listIngredients(client: SupabaseClient): Promise<Ingredient[]> {
  const { data, error } = await client
    .from("ingredients")
    .select("*")
    .eq("status", "active")
    .order("name", { ascending: true });

  if (error) {
    throw new Error(errorMessage(error, "Failed to load Ingredients"));
  }

  return (data ?? []).map(toIngredient);
}

export async function createIngredient(
  client: SupabaseClient,
  input: { name: string; stockUnit: string; isHandDepleted?: boolean }
): Promise<Ingredient> {
  const { data, error } = await client
    .from("ingredients")
    .insert({
      name: input.name,
      stock_unit: input.stockUnit,
      is_hand_depleted: input.isHandDepleted ?? false,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(errorMessage(error, "Failed to create Ingredient"));
  }

  return toIngredient(data);
}

export async function updateIngredient(
  client: SupabaseClient,
  id: string,
  input: { name?: string; stockUnit?: string; isHandDepleted?: boolean }
): Promise<Ingredient> {
  const patch: Row = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.stockUnit !== undefined) patch.stock_unit = input.stockUnit;
  if (input.isHandDepleted !== undefined) patch.is_hand_depleted = input.isHandDepleted;

  const { data, error } = await client
    .from("ingredients")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(errorMessage(error, "Failed to update Ingredient"));
  }

  return toIngredient(data);
}

export async function setHandDepleted(
  client: SupabaseClient,
  id: string,
  isHandDepleted: boolean
): Promise<Ingredient> {
  return updateIngredient(client, id, { isHandDepleted });
}

export async function deleteIngredient(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from("ingredients").delete().eq("id", id);

  if (error) {
    throw new Error(errorMessage(error, "Failed to delete Ingredient"));
  }
}

export async function listAliases(
  client: SupabaseClient,
  ingredientId: string
): Promise<IngredientAlias[]> {
  const { data, error } = await client
    .from("ingredient_aliases")
    .select("*")
    .eq("ingredient_id", ingredientId)
    .order("alias", { ascending: true });

  if (error) {
    throw new Error(errorMessage(error, "Failed to load Aliases"));
  }

  return (data ?? []).map(toAlias);
}

export async function addAlias(
  client: SupabaseClient,
  ingredientId: string,
  alias: string
): Promise<IngredientAlias> {
  const { data, error } = await client
    .from("ingredient_aliases")
    .insert({ ingredient_id: ingredientId, alias })
    .select("*")
    .single();

  if (error) {
    throw new Error(errorMessage(error, "Failed to add Alias"));
  }

  return toAlias(data);
}

export async function removeAlias(client: SupabaseClient, aliasId: string): Promise<void> {
  const { error } = await client.from("ingredient_aliases").delete().eq("id", aliasId);

  if (error) {
    throw new Error(errorMessage(error, "Failed to remove Alias"));
  }
}

export async function listUnitConversions(
  client: SupabaseClient,
  ingredientId: string
): Promise<UnitConversion[]> {
  const { data, error } = await client
    .from("unit_conversions")
    .select("*")
    .eq("ingredient_id", ingredientId)
    .order("from_unit", { ascending: true });

  if (error) {
    throw new Error(errorMessage(error, "Failed to load Convertible Units"));
  }

  return (data ?? []).map(toUnitConversion);
}

export async function addUnitConversion(
  client: SupabaseClient,
  ingredientId: string,
  input: { fromUnit: string; factorToStockUnit: number }
): Promise<UnitConversion> {
  const { data, error } = await client
    .from("unit_conversions")
    .insert({
      ingredient_id: ingredientId,
      from_unit: input.fromUnit,
      factor_to_stock_unit: input.factorToStockUnit,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(errorMessage(error, "Failed to add Convertible Unit"));
  }

  return toUnitConversion(data);
}

export async function removeUnitConversion(
  client: SupabaseClient,
  unitConversionId: string
): Promise<void> {
  const { error } = await client
    .from("unit_conversions")
    .delete()
    .eq("id", unitConversionId);

  if (error) {
    throw new Error(errorMessage(error, "Failed to remove Convertible Unit"));
  }
}

/**
 * Resolves free text to an Ingredient via the `resolve_ingredient_name`
 * RPC: exact match, then alias, then ranked pg_trgm fuzzy candidates.
 * Never guesses — a single exact/alias hit resolves outright, anything
 * else (including zero results) comes back as `candidates` for a
 * "did you mean" prompt.
 */
export async function resolveIngredientName(
  client: SupabaseClient,
  name: string,
  limit = 5
): Promise<ResolveResult> {
  const { data, error } = await client.rpc("resolve_ingredient_name", {
    p_name: name,
    p_limit: limit,
  });

  if (error) {
    throw new Error(errorMessage(error, "Failed to resolve Ingredient name"));
  }

  const rows = (data ?? []) as Row[];
  const candidates: IngredientCandidate[] = rows.map((row) => ({
    ingredientId: row.ingredient_id as string,
    name: row.name as string,
    matchKind: row.match_kind as IngredientCandidate["matchKind"],
    score: Number(row.score),
  }));

  const top = candidates[0];
  if (top && (top.matchKind === "exact" || top.matchKind === "alias")) {
    return { resolved: true, ingredientId: top.ingredientId, name: top.name, matchKind: top.matchKind };
  }

  return { resolved: false, candidates };
}

/**
 * Converts `amount` in `unit` into an Ingredient's Stock Unit via the
 * `convert_to_stock_unit` RPC — the only place in the system that performs
 * this arithmetic. Throws with the database's clear-reason message when no
 * factor exists, rather than falling back to a guess.
 */
export async function convertToStockUnit(
  client: SupabaseClient,
  ingredientId: string,
  amount: number,
  unit: string
): Promise<number> {
  const { data, error } = await client.rpc("convert_to_stock_unit", {
    p_ingredient_id: ingredientId,
    p_amount: amount,
    p_unit: unit,
  });

  if (error) {
    throw new Error(errorMessage(error, "Failed to convert amount to Stock Unit"));
  }

  return Number(data);
}
