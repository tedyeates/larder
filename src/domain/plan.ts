/**
 * Scaling recipes and comparing them with the pantry.
 *
 * Recipe lines are allowed to be incomplete — imported recipes, "to taste",
 * an ingredient nobody has matched yet. Those lines are reported as unresolved
 * and excluded from arithmetic. Nothing here guesses a unit or a weight.
 */

import { ConversionError, type IngredientUnits, roundAmount, toBase, type UnitCode } from "./units";

export interface RecipeLine {
  readonly ingredientId: string | null;
  /** Null means "no arithmetic value" — a splash, to taste, a garnish. */
  readonly quantity: number | null;
  readonly unit: UnitCode | null;
  readonly optional?: boolean;
  readonly label?: string;
}

export type UnresolvedReason = "unmatched" | "unmeasured" | "conversion";

export interface UnresolvedLine {
  readonly lineIndex: number;
  readonly reason: UnresolvedReason;
  readonly optional: boolean;
  readonly detail: string;
}

export interface Requirement {
  readonly ingredientId: string;
  /** Base units (g, ml, or the count unit). */
  readonly amount: number;
}

export interface ScaledRecipe {
  readonly requirements: readonly Requirement[];
  readonly unresolved: readonly UnresolvedLine[];
}

function mergeRequirements(
  target: Map<string, number>,
  ingredientId: string,
  amount: number,
): void {
  target.set(ingredientId, roundAmount((target.get(ingredientId) ?? 0) + amount));
}

export function scaleRecipe(
  lines: readonly RecipeLine[],
  servings: { readonly portions: number; readonly recipeServings: number },
  ingredients: ReadonlyMap<string, IngredientUnits>,
): ScaledRecipe {
  if (servings.recipeServings <= 0) {
    throw new Error("Recipe servings must be greater than zero");
  }

  const factor = Math.max(0, servings.portions) / servings.recipeServings;
  const totals = new Map<string, number>();
  const unresolved: UnresolvedLine[] = [];

  lines.forEach((line, lineIndex) => {
    const label = line.label ?? `line ${lineIndex + 1}`;

    if (line.ingredientId === null) {
      unresolved.push({
        lineIndex,
        reason: "unmatched",
        optional: line.optional ?? false,
        detail: `"${label}" is not matched to an ingredient yet.`,
      });
      return;
    }

    const ingredient = ingredients.get(line.ingredientId);
    if (ingredient === undefined) {
      unresolved.push({
        lineIndex,
        reason: "unmatched",
        optional: line.optional ?? false,
        detail: `"${label}" points at an ingredient that no longer exists.`,
      });
      return;
    }

    if (line.quantity === null || line.unit === null) {
      unresolved.push({
        lineIndex,
        reason: "unmeasured",
        optional: line.optional ?? false,
        detail: `"${label}" has no amount, so it cannot be deducted.`,
      });
      return;
    }

    try {
      const amount = toBase(line.quantity * factor, line.unit, ingredient);
      if (amount <= 0) return;
      mergeRequirements(totals, ingredient.id, amount);
    } catch (error) {
      const detail =
        error instanceof ConversionError
          ? error.message
          : `"${label}" could not be converted to ${ingredient.stockUnit}.`;
      unresolved.push({
        lineIndex,
        reason: "conversion",
        optional: line.optional ?? false,
        detail,
      });
    }
  });

  return {
    requirements: [...totals].map(([ingredientId, amount]) => ({ ingredientId, amount })),
    unresolved,
  };
}

export interface RecipeForPlanning {
  readonly servings: number;
  readonly lines: readonly RecipeLine[];
}

export interface PlannedMeal {
  readonly recipeId: string;
  /** Portions this slot intends to make. */
  readonly portions: number;
}

export interface PlanRequirements {
  readonly requirements: readonly Requirement[];
  readonly unresolved: readonly (UnresolvedLine & { recipeId: string })[];
}

/** Everything a set of planned meals needs, merged per ingredient. */
export function planRequirements(
  meals: readonly PlannedMeal[],
  recipes: ReadonlyMap<string, RecipeForPlanning>,
  ingredients: ReadonlyMap<string, IngredientUnits>,
): PlanRequirements {
  const totals = new Map<string, number>();
  const unresolved: (UnresolvedLine & { recipeId: string })[] = [];

  for (const meal of meals) {
    const recipe = recipes.get(meal.recipeId);
    if (recipe === undefined) continue;

    const scaled = scaleRecipe(
      recipe.lines,
      { portions: meal.portions, recipeServings: recipe.servings },
      ingredients,
    );
    for (const requirement of scaled.requirements) {
      mergeRequirements(totals, requirement.ingredientId, requirement.amount);
    }
    for (const line of scaled.unresolved) {
      unresolved.push({ ...line, recipeId: meal.recipeId });
    }
  }

  return {
    requirements: [...totals].map(([ingredientId, amount]) => ({ ingredientId, amount })),
    unresolved,
  };
}

export interface Shortfall {
  readonly ingredientId: string;
  readonly required: number;
  readonly available: number;
  readonly shortfall: number;
}

/**
 * What the pantry can't cover. `leftover` meals never appear here — they were
 * deducted when they were cooked.
 */
export function diffAgainstPantry(
  requirements: readonly Requirement[],
  balances: ReadonlyMap<string, number>,
): Shortfall[] {
  const shortfalls: Shortfall[] = [];

  for (const requirement of requirements) {
    const available = roundAmount(balances.get(requirement.ingredientId) ?? 0);
    const shortfall = roundAmount(requirement.amount - available);
    if (shortfall > 0) {
      shortfalls.push({
        ingredientId: requirement.ingredientId,
        required: requirement.amount,
        available,
        shortfall,
      });
    }
  }

  return shortfalls.sort((a, b) => b.shortfall - a.shortfall);
}
