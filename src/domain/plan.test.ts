import { describe, expect, it } from "vitest";
import { diffAgainstPantry, planRequirements, type RecipeLine, scaleRecipe } from "./plan";
import type { IngredientUnits } from "./units";

const ingredients = new Map<string, IngredientUnits>([
  ["rice", { id: "rice", name: "Rice", stockUnit: "kg" }],
  ["onion", { id: "onion", name: "Onion", stockUnit: "g", gramsPer: { each: 150 } }],
  ["milk", { id: "milk", name: "Milk", stockUnit: "ml" }],
]);

const line = (overrides: Partial<RecipeLine>): RecipeLine => ({
  ingredientId: "rice",
  quantity: 100,
  unit: "g",
  ...overrides,
});

const servings = (portions: number, recipeServings = 2) => ({ portions, recipeServings });

describe("scaleRecipe", () => {
  it("scales by portions over recipe servings", () => {
    const result = scaleRecipe([line({ quantity: 100 })], servings(4), ingredients);
    expect(result.requirements).toEqual([{ ingredientId: "rice", amount: 200 }]);
    expect(result.unresolved).toEqual([]);
  });

  it("scales down without losing precision", () => {
    const result = scaleRecipe([line({ quantity: 100 })], servings(1), ingredients);
    expect(result.requirements[0]?.amount).toBe(50);
  });

  it("merges repeated ingredients into one requirement", () => {
    const result = scaleRecipe(
      [line({ quantity: 100 }), line({ quantity: 50 })],
      servings(2),
      ingredients,
    );
    expect(result.requirements).toEqual([{ ingredientId: "rice", amount: 150 }]);
  });

  it("converts a recipe unit into the stock unit", () => {
    const result = scaleRecipe(
      [line({ ingredientId: "onion", quantity: 2, unit: "each" })],
      servings(2),
      ingredients,
    );
    expect(result.requirements).toEqual([{ ingredientId: "onion", amount: 300 }]);
  });

  it("reports an unmatched ingredient instead of inventing one", () => {
    const result = scaleRecipe(
      [line({ ingredientId: null, label: "a handful of parsley" })],
      servings(2),
      ingredients,
    );
    expect(result.requirements).toEqual([]);
    expect(result.unresolved[0]?.reason).toBe("unmatched");
    expect(result.unresolved[0]?.detail).toContain("parsley");
  });

  it("reports an unmeasured line", () => {
    const result = scaleRecipe([line({ quantity: null })], servings(2), ingredients);
    expect(result.unresolved[0]?.reason).toBe("unmeasured");
  });

  it("reports a conversion failure and excludes the line from arithmetic", () => {
    const result = scaleRecipe([line({ unit: "cup" })], servings(2), ingredients);
    expect(result.requirements).toEqual([]);
    expect(result.unresolved[0]?.reason).toBe("conversion");
    expect(result.unresolved[0]?.detail).toContain("Rice");
  });

  it("keeps the optional flag on unresolved lines", () => {
    const result = scaleRecipe(
      [line({ ingredientId: null, optional: true })],
      servings(2),
      ingredients,
    );
    expect(result.unresolved[0]?.optional).toBe(true);
  });

  it("produces nothing for zero portions", () => {
    const result = scaleRecipe([line({})], servings(0), ingredients);
    expect(result.requirements).toEqual([]);
  });

  it("refuses a recipe with no servings", () => {
    expect(() =>
      scaleRecipe([line({})], { portions: 1, recipeServings: 0 }, ingredients),
    ).toThrow();
  });
});

describe("planRequirements", () => {
  it("merges requirements across meals", () => {
    const recipes = new Map([
      [
        "chilli",
        {
          servings: 4,
          lines: [
            line({ quantity: 400 }),
            line({ ingredientId: "onion", quantity: 2, unit: "each" as const }),
          ],
        },
      ],
      ["curry", { servings: 2, lines: [line({ quantity: 200 })] }],
    ]);
    const result = planRequirements(
      [
        { recipeId: "chilli", portions: 4 },
        { recipeId: "curry", portions: 2 },
      ],
      recipes,
      ingredients,
    );
    expect(result.requirements).toEqual(
      expect.arrayContaining([
        { ingredientId: "rice", amount: 600 },
        { ingredientId: "onion", amount: 300 },
      ]),
    );
  });

  it("carries the recipe id on unresolved lines so the plan can point at the meal", () => {
    const recipes = new Map([
      ["stew", { servings: 2, lines: [line({ ingredientId: null, label: "bay leaf" })] }],
    ]);
    const result = planRequirements([{ recipeId: "stew", portions: 2 }], recipes, ingredients);
    expect(result.unresolved[0]?.recipeId).toBe("stew");
  });

  it("skips meals whose recipe is missing", () => {
    const result = planRequirements([{ recipeId: "gone", portions: 2 }], new Map(), ingredients);
    expect(result.requirements).toEqual([]);
  });
});

describe("diffAgainstPantry", () => {
  it("returns only what is missing", () => {
    const shortfalls = diffAgainstPantry(
      [
        { ingredientId: "rice", amount: 500 },
        { ingredientId: "milk", amount: 200 },
      ],
      new Map([
        ["rice", 100],
        ["milk", 500],
      ]),
    );
    expect(shortfalls).toEqual([
      { ingredientId: "rice", required: 500, available: 100, shortfall: 400 },
    ]);
  });

  it("treats a completely absent ingredient as zero available", () => {
    const shortfalls = diffAgainstPantry([{ ingredientId: "rice", amount: 300 }], new Map());
    expect(shortfalls[0]).toEqual({
      ingredientId: "rice",
      required: 300,
      available: 0,
      shortfall: 300,
    });
  });

  it("sorts the biggest gap first", () => {
    const shortfalls = diffAgainstPantry(
      [
        { ingredientId: "a", amount: 100 },
        { ingredientId: "b", amount: 900 },
      ],
      new Map(),
    );
    expect(shortfalls.map((s) => s.ingredientId)).toEqual(["b", "a"]);
  });

  it("returns nothing when the pantry covers the plan", () => {
    expect(
      diffAgainstPantry([{ ingredientId: "rice", amount: 100 }], new Map([["rice", 900]])),
    ).toEqual([]);
  });
});
