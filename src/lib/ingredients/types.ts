/**
 * Domain types for the Ingredient Registry (#3). Mirrors the shape of
 * `public.ingredients`, `public.ingredient_aliases` and
 * `public.unit_conversions` — see
 * supabase/migrations/20260102000000_ingredient_registry.sql.
 */

export type IngredientStatus = "active" | "archived";

export type Ingredient = {
  id: string;
  name: string;
  stockUnit: string;
  isHandDepleted: boolean;
  lastPurchasedAmount: number | null;
  status: IngredientStatus;
  createdAt: string;
};

export type IngredientAlias = {
  id: string;
  ingredientId: string;
  alias: string;
  createdAt: string;
};

export type UnitConversion = {
  id: string;
  ingredientId: string;
  fromUnit: string;
  factorToStockUnit: number;
  createdAt: string;
};

export type IngredientMatchKind = "exact" | "alias" | "fuzzy";

/** One row returned by the `resolve_ingredient_name` RPC. */
export type IngredientCandidate = {
  ingredientId: string;
  name: string;
  matchKind: IngredientMatchKind;
  score: number;
};

/**
 * Outcome of resolving free text to an Ingredient. Exactly one of
 * `ingredient`/`candidates` is meaningful: a single exact or alias match
 * resolves outright, anything else surfaces ranked candidates (possibly
 * empty) for a "did you mean" prompt.
 */
export type ResolveResult =
  | { resolved: true; ingredientId: string; name: string; matchKind: "exact" | "alias" }
  | { resolved: false; candidates: IngredientCandidate[] };
