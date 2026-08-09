import { describe, expect, it } from "vitest";
import { parseRecipeMarkdown } from "./recipe-parser.mjs";

const registry = [
  { id: "leek", name: "Leek", stockUnit: "pieces", isHandDepleted: false, aliases: ["Leak"] },
  { id: "soy", name: "Soy sauce", stockUnit: "bottle", isHandDepleted: true },
  { id: "beans", name: "Beansprouts", stockUnit: "g", isHandDepleted: false },
  { id: "chicken-thighs", name: "Chicken thighs", stockUnit: "pieces", isHandDepleted: false },
  {
    id: "flour",
    name: "Flour",
    stockUnit: "g",
    isHandDepleted: false,
    conversions: [{ fromUnit: "tbsp", factorToStockUnit: 8 }],
  },
] as const;

const recipeMarkdown = `---
title: Spring stir-fry
tags:
  - Quick
  - Dairy-free
servings: 3
scaleable: 2x
rating: 4
prep time: 10m
cook time: 20 minutes
source: https://example.com/stir-fry
---

# Spring stir-fry

## Ingredients
| Ingredient | Amount | Unit | Notes |
| --- | --- | --- | --- |
| Leak | 1/2 | pieces | sliced |
| Soy sauce | — | — | splash |
| Beansprouts | 1 | handful | |
| Chicken | 2 | pieces | |
| Leek | 1/2 | | |
| Flour | 2 tbsp | | |

## Equipment
- Wok

## Steps
1. Heat wok.
2. Stir-fry everything.

## Serve With
- Rice

## Cook Log
- 2026-06-08 | ×2 | "fed friends"
`;

describe("Recipe Parser", () => {
  it.each([
    {
      name: "reads frontmatter, all readable sections, aliases, fractions and convertible combined quantities",
      markdown: recipeMarkdown,
      expected: {
        name: "Spring stir-fry",
        tags: ["Quick", "Dairy-free"],
        servings: 3,
        maxMultiplier: 2,
        rating: 4,
        prepMinutes: 10,
        cookMinutes: 20,
        source: "https://example.com/stir-fry",
        lines: [
          { rawName: "Leak", ingredientId: "leek", amount: 0.5, unit: "pieces", note: "sliced" },
          { rawName: "Soy sauce", ingredientId: "soy", amount: null, unit: null, note: "splash" },
          { rawName: "Beansprouts", ingredientId: "beans", amount: 1, unit: "handful", note: null },
          { rawName: "Chicken", ingredientId: null, amount: 2, unit: "pieces", note: null },
          { rawName: "Leek", ingredientId: "leek", amount: 0.5, unit: null, note: null },
          { rawName: "Flour", ingredientId: "flour", amount: 2, unit: "tbsp", note: null },
        ],
      },
      inconsistencies: [
        { line: 2, reason: "non_convertible_unit" },
        { line: 3, reason: "unresolved_ingredient" },
        { line: 4, reason: "missing_unit" },
      ],
    },
    {
      name: "treats scaleable no as one and flags an em-dash quantity for an Auto-Depleted Ingredient",
      markdown: `---
title: Plain recipe
servings: 2
scaleable: no
---

## Ingredients
| Ingredient | Amount | Unit |
| --- | --- | --- |
| Leek | — | — |

## Steps
1. Cook it.
`,
      expected: { name: "Plain recipe", servings: 2, maxMultiplier: 1 },
      inconsistencies: [{ line: 0, reason: "unmeasured_on_auto_depleted" }],
    },
    {
      name: "keeps an unnumbered amount Unmeasured, drops an out-of-range rating, reads hours, and reads the Cook Log",
      markdown: `---
title: Slow braise
servings: 4
rating: 9
prep time: 15 mins
cook time: 1h 30m
---

## Ingredients
| Ingredient | Amount | Unit |
| --- | --- | --- |
| Beansprouts | to taste | g |

## Cook Log
- 2026-05-01 | ×1
`,
      expected: {
        name: "Slow braise",
        servings: 4,
        rating: null,
        prepMinutes: 15,
        cookMinutes: 90,
        // No unit survives without an amount: recipe_lines rejects that pair
        // outright, so storing it would abort the whole import.
        lines: [{ rawName: "Beansprouts", ingredientId: "beans", amount: null, unit: null, note: null }],
        cookLog: [{ occurredOn: "2026-05-01", multiplier: 1, note: null }],
      },
      inconsistencies: [{ line: 0, reason: "invalid_amount" }],
    },
  ])("$name", ({ markdown, expected, inconsistencies }) => {
    const result = parseRecipeMarkdown(markdown, registry);

    expect(result.recipe).toMatchObject(expected);
    if (expected.name === "Spring stir-fry") {
      expect(result.recipe.steps).toContain("Equipment\n- Wok");
      expect(result.recipe.steps).toContain("Steps\n1. Heat wok.");
      expect(result.recipe.steps).toContain("Serve With\n- Rice");
    }
    expect(result.inconsistencies.map((item) => ({ line: item.line, reason: item.reason }))).toEqual(inconsistencies);
  });

  it("ranks but never silently accepts an unmatched Ingredient", () => {
    const result = parseRecipeMarkdown(recipeMarkdown, registry);
    const unresolved = result.inconsistencies.find((item) => item.reason === "unresolved_ingredient");

    expect(unresolved).toMatchObject({ rawName: "Chicken" });
    expect(unresolved?.candidates[0]).toMatchObject({ ingredientId: "chicken-thighs", name: "Chicken thighs" });
    expect(result.recipe.lines[3].ingredientId).toBeNull();
  });
});
