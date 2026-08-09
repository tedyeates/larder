/**
 * Domain types for Recipes (#7). Mirrors the shape of `public.recipes`,
 * `public.recipe_tags`, `public.recipe_lines`,
 * `public.recipe_line_substitutes` and the `public.recipe_line_inconsistencies`
 * / `public.recipe_status` / `public.recipe_cookability` views — see
 * supabase/migrations/20260106000000_recipes.sql.
 */

export type Recipe = {
  id: string;
  name: string;
  servings: number;
  maxMultiplier: number;
  rating: number | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  source: string | null;
  steps: string | null;
  createdAt: string;
};

/** One Ingredient a Recipe needs. `ingredientId` is null while Unresolved. */
export type RecipeLine = {
  id: string;
  recipeId: string;
  ingredientId: string | null;
  rawName: string | null;
  amount: number | null;
  unit: string | null;
  note: string | null;
  isEssential: boolean;
  position: number;
  createdAt: string;
};

/** An Ingredient acceptable as a stand-in for one specific Recipe Line. */
export type RecipeLineSubstitute = {
  id: string;
  recipeLineId: string;
  ingredientId: string;
  createdAt: string;
};

export type RecipeLineSubstituteWithIngredient = RecipeLineSubstitute & {
  ingredientName: string;
};

/** A Recipe Line joined with enough Ingredient context to render without extra lookups. */
export type RecipeLineWithDetails = RecipeLine & {
  ingredientName: string | null;
  stockUnit: string | null;
  isHandDepleted: boolean | null;
  substitutes: RecipeLineSubstituteWithIngredient[];
};

/** A Recipe with its Tags and full Lines, the shape the detail/reading screen needs in one read. */
export type RecipeWithLines = Recipe & {
  tags: string[];
  lines: RecipeLineWithDetails[];
};

export type InconsistencyReason =
  | "unresolved_ingredient"
  | "non_convertible_unit"
  | "unmeasured_on_auto_depleted";

/** One row from `recipe_line_inconsistencies`: a Line currently blocking exact arithmetic. */
export type RecipeInconsistency = {
  recipeLineId: string;
  recipeId: string;
  reason: InconsistencyReason;
  lineLabel: string;
};

export type RecipeLineStatus = "available" | "fulfilled_by_substitute" | "missing";

/** One row from `recipe_status`: a Line's status against the Pantry. */
export type RecipeLinePantryStatus = {
  recipeLineId: string;
  recipeId: string;
  ingredientId: string | null;
  isEssential: boolean;
  status: RecipeLineStatus;
};

/** One row from `recipe_cookability`: whether a Recipe's every Line is covered. */
export type RecipeCookability = {
  recipeId: string;
  name: string;
  isCookable: boolean;
};

/** Human-readable labels for each Inconsistency reason, for the Recipe screen's list. */
export const INCONSISTENCY_REASON_LABELS: Record<InconsistencyReason, string> = {
  unresolved_ingredient: "Ingredient not matched yet",
  non_convertible_unit: "Unit has no known conversion to the Stock Unit",
  unmeasured_on_auto_depleted: "No quantity given, but this Ingredient isn't Hand-Depleted",
};

/**
 * A fixed, known vocabulary of tag values recognised as Allergen Flags.
 * Anything else in `recipe_tags` is an ordinary tag (cuisine, meal type).
 * Matched case-insensitively — see recipes.ts `allergenFlagsFromTags`.
 */
export const ALLERGEN_TAGS = [
  "dairy",
  "gluten",
  "nuts",
  "peanuts",
  "shellfish",
  "eggs",
  "soy",
  "fish",
  "sesame",
] as const;

export type AllergenTag = (typeof ALLERGEN_TAGS)[number];
