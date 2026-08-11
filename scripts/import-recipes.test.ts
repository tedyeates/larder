import { describe, expect, it } from "vitest";
import { mappingProposals } from "./import-recipes.mjs";

describe("mappingProposals", () => {
  it("flattens every Recipe's Inconsistencies into one confirmable list with 1-based line numbers", () => {
    const proposals = mappingProposals([
      {
        recipe: { name: "Spring stir-fry" },
        relativePath: "Recipes/stir-fry.md",
        inconsistencies: [
          { line: 0, rawName: "Chicken", reason: "unresolved_ingredient", candidates: [{ ingredientId: "chicken-thighs", name: "Chicken thighs", score: 0.9 }] },
          { line: 3, rawName: "Beansprouts", reason: "non_convertible_unit", candidates: [] },
        ],
      },
      {
        recipe: { name: "Slow braise" },
        relativePath: "Recipes/braise.md",
        inconsistencies: [],
      },
    ]);

    expect(proposals).toEqual([
      {
        recipe: "Spring stir-fry",
        sourcePath: "Recipes/stir-fry.md",
        line: 1,
        rawName: "Chicken",
        reason: "unresolved_ingredient",
        candidates: [{ ingredientId: "chicken-thighs", name: "Chicken thighs", score: 0.9 }],
      },
      {
        recipe: "Spring stir-fry",
        sourcePath: "Recipes/stir-fry.md",
        line: 4,
        rawName: "Beansprouts",
        reason: "non_convertible_unit",
        candidates: [],
      },
    ]);
  });

  it("returns nothing for a batch of Recipes with no outstanding Inconsistencies", () => {
    expect(mappingProposals([{ recipe: { name: "Slow braise" }, relativePath: "Recipes/braise.md", inconsistencies: [] }])).toEqual([]);
  });
});
