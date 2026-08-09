import { describe, expect, it, vi } from "vitest";
import {
  addLine,
  addSubstitute,
  addTag,
  allergenFlagsFromTags,
  createRecipe,
  deleteRecipe,
  getCookability,
  getRecipeWithLines,
  listInconsistencies,
  listLines,
  listLineStatuses,
  listRecipes,
  listSubstitutes,
  rateRecipe,
  removeLine,
  removeSubstitute,
  reorderLines,
  resolveLine,
  updateLine,
  updateRecipe,
} from "./recipes";

/**
 * Minimal fake mirroring the slice of the Supabase JS client's fluent
 * query builder these functions call, plus `.rpc`. Mirrors
 * src/lib/ingredients/registry.test.ts's fake — `.eq()` is both a chain
 * link and a terminal, achieved by attaching `.then` to the builder.
 */
function makeFakeClient(result: { data?: unknown; error?: { message: string } | null }) {
  const terminal = { data: result.data ?? null, error: result.error ?? null };

  const builder: Record<string, unknown> = {
    then: (resolve: (v: typeof terminal) => void) => resolve(terminal),
  };

  builder.select = vi.fn(() => builder);
  builder.insert = vi.fn(() => builder);
  builder.update = vi.fn(() => builder);
  builder.delete = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.in = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.single = vi.fn(() => Promise.resolve(terminal));
  builder.maybeSingle = vi.fn(() => Promise.resolve(terminal));

  const from = vi.fn(() => builder);
  const rpc = vi.fn(() => Promise.resolve(terminal));

  return { from, rpc } as unknown as import("@supabase/supabase-js").SupabaseClient;
}

describe("listRecipes", () => {
  it("maps rows from snake_case to the domain shape", async () => {
    const client = makeFakeClient({
      data: [
        {
          id: "r1",
          name: "Chicken Stir-fry",
          servings: 4,
          max_multiplier: 3,
          rating: null,
          prep_minutes: 10,
          cook_minutes: 15,
          source: "family recipe",
          steps: "Fry it.",
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
    });

    const result = await listRecipes(client);

    expect(result).toEqual([
      {
        id: "r1",
        name: "Chicken Stir-fry",
        servings: 4,
        maxMultiplier: 3,
        rating: null,
        prepMinutes: 10,
        cookMinutes: 15,
        source: "family recipe",
        steps: "Fry it.",
        createdAt: "2026-01-01T00:00:00Z",
      },
    ]);
  });

  it("throws a clear error when the query fails", async () => {
    const client = makeFakeClient({ error: { message: "boom" } });
    await expect(listRecipes(client)).rejects.toThrow("boom");
  });
});

describe("createRecipe / updateRecipe / deleteRecipe", () => {
  it("creates a Recipe from name, servings and the optional fields", async () => {
    const client = makeFakeClient({
      data: {
        id: "r2",
        name: "Sushi",
        servings: 2,
        max_multiplier: 1,
        rating: null,
        prep_minutes: null,
        cook_minutes: null,
        source: null,
        steps: null,
        created_at: "2026-01-01T00:00:00Z",
      },
    });

    const result = await createRecipe(client, { name: "Sushi", servings: 2 });
    expect(result.name).toBe("Sushi");
    expect(result.maxMultiplier).toBe(1);
  });

  it("updates a Recipe's fields", async () => {
    const client = makeFakeClient({
      data: {
        id: "r2",
        name: "Sushi Rolls",
        servings: 4,
        max_multiplier: 1,
        rating: null,
        prep_minutes: null,
        cook_minutes: null,
        source: null,
        steps: null,
        created_at: "2026-01-01T00:00:00Z",
      },
    });

    const result = await updateRecipe(client, "r2", { name: "Sushi Rolls", servings: 4 });
    expect(result.name).toBe("Sushi Rolls");
    expect(result.servings).toBe(4);
  });

  it("propagates a clear error on update failure", async () => {
    const client = makeFakeClient({ error: { message: "constraint violated" } });
    await expect(updateRecipe(client, "r2", { servings: 0 })).rejects.toThrow(
      "constraint violated"
    );
  });

  it("deletes a Recipe", async () => {
    const client = makeFakeClient({ error: null });
    await expect(deleteRecipe(client, "r2")).resolves.toBeUndefined();
  });
});

describe("rateRecipe", () => {
  it("sets a Recipe's rating independent of any Cook", async () => {
    const client = makeFakeClient({
      data: {
        id: "r2",
        name: "Sushi",
        servings: 2,
        max_multiplier: 1,
        rating: 5,
        prep_minutes: null,
        cook_minutes: null,
        source: null,
        steps: null,
        created_at: "2026-01-01T00:00:00Z",
      },
    });

    const result = await rateRecipe(client, "r2", 5);
    expect(result.rating).toBe(5);
  });
});

describe("addTag", () => {
  it("inserts a tag row for the Recipe", async () => {
    const client = makeFakeClient({ error: null });
    await expect(addTag(client, "r2", "dairy")).resolves.toBeUndefined();
  });
});

describe("allergenFlagsFromTags", () => {
  it("returns only tags matching the known allergen vocabulary, case-insensitively", () => {
    expect(allergenFlagsFromTags(["Dairy", "stir-fry", "GLUTEN", "quick"])).toEqual([
      "Dairy",
      "GLUTEN",
    ]);
  });

  it("returns an empty list when no tag matches", () => {
    expect(allergenFlagsFromTags(["quick", "family favourite"])).toEqual([]);
  });
});

describe("addLine / updateLine / removeLine", () => {
  it("adds a line via the create_recipe_line RPC", async () => {
    const client = makeFakeClient({
      data: {
        id: "l1",
        recipe_id: "r1",
        ingredient_id: "i1",
        raw_name: null,
        amount: "8",
        unit: "pieces",
        note: null,
        is_essential: false,
        position: 0,
        created_at: "2026-01-01T00:00:00Z",
      },
    });

    const result = await addLine(client, {
      recipeId: "r1",
      ingredientId: "i1",
      amount: 8,
      unit: "pieces",
    });

    expect(client.rpc).toHaveBeenCalledWith(
      "create_recipe_line",
      expect.objectContaining({ p_recipe_id: "r1", p_ingredient_id: "i1", p_amount: 8, p_unit: "pieces" })
    );
    expect(result.amount).toBe(8);
  });

  it("surfaces the database's Inconsistency message on a non-convertible unit", async () => {
    const client = makeFakeClient({
      error: { message: "No Convertible Unit factor from \"handful\" to Stock Unit \"pieces\"" },
    });
    await expect(
      addLine(client, { recipeId: "r1", ingredientId: "i1", amount: 1, unit: "handful" })
    ).rejects.toThrow("No Convertible Unit factor");
  });

  it("adds an Unresolved line with no ingredientId", async () => {
    const client = makeFakeClient({
      data: {
        id: "l2",
        recipe_id: "r1",
        ingredient_id: null,
        raw_name: "Leak",
        amount: "2",
        unit: "pieces",
        note: null,
        is_essential: false,
        position: 1,
        created_at: "2026-01-01T00:00:00Z",
      },
    });

    const result = await addLine(client, {
      recipeId: "r1",
      ingredientId: null,
      rawName: "Leak",
      amount: 2,
      unit: "pieces",
    });

    expect(result.ingredientId).toBeNull();
    expect(result.rawName).toBe("Leak");
  });

  it("updates a line via the update_recipe_line RPC", async () => {
    const client = makeFakeClient({
      data: {
        id: "l1",
        recipe_id: "r1",
        ingredient_id: "i1",
        raw_name: null,
        amount: "10",
        unit: "pieces",
        note: null,
        is_essential: false,
        position: 0,
        created_at: "2026-01-01T00:00:00Z",
      },
    });

    const result = await updateLine(client, "l1", { ingredientId: "i1", amount: 10, unit: "pieces" });
    expect(result.amount).toBe(10);
  });

  it("removes a line", async () => {
    const client = makeFakeClient({ error: null });
    await expect(removeLine(client, "l1")).resolves.toBeUndefined();
  });
});

describe("reorderLines", () => {
  it("calls reorder_recipe_lines with the recipe id and full ordered array", async () => {
    const client = makeFakeClient({ data: null });
    await reorderLines(client, "r1", ["l2", "l1"]);
    expect(client.rpc).toHaveBeenCalledWith("reorder_recipe_lines", {
      p_recipe_id: "r1",
      p_line_ids: ["l2", "l1"],
    });
  });

  it("propagates a clear error when the id set doesn't match", async () => {
    const client = makeFakeClient({
      error: { message: "reorder_recipe_lines requires every existing Recipe Line id" },
    });
    await expect(reorderLines(client, "r1", ["l1"])).rejects.toThrow(
      "requires every existing Recipe Line id"
    );
  });
});

describe("resolveLine", () => {
  it("resolves an Unresolved line to an Ingredient, remembering an Alias by default", async () => {
    const client = makeFakeClient({
      data: {
        id: "l2",
        recipe_id: "r1",
        ingredient_id: "i9",
        raw_name: "Leak",
        amount: "2",
        unit: "pieces",
        note: null,
        is_essential: false,
        position: 1,
        created_at: "2026-01-01T00:00:00Z",
      },
    });

    const result = await resolveLine(client, "l2", "i9");

    expect(client.rpc).toHaveBeenCalledWith("resolve_recipe_line", {
      p_line_id: "l2",
      p_ingredient_id: "i9",
      p_create_alias: true,
    });
    expect(result.ingredientId).toBe("i9");
  });

  it("skips Alias creation when createAlias is false", async () => {
    const client = makeFakeClient({ data: { id: "l2", recipe_id: "r1" } });
    await resolveLine(client, "l2", "i9", false);
    expect(client.rpc).toHaveBeenCalledWith("resolve_recipe_line", {
      p_line_id: "l2",
      p_ingredient_id: "i9",
      p_create_alias: false,
    });
  });
});

describe("substitutes", () => {
  it("lists Substitutes joined with the Ingredient's name", async () => {
    const client = makeFakeClient({
      data: [
        {
          id: "s1",
          recipe_line_id: "l1",
          ingredient_id: "i3",
          created_at: "2026-01-01T00:00:00Z",
          ingredients: { name: "Rice wine" },
        },
      ],
    });

    const result = await listSubstitutes(client, "l1");
    expect(result).toEqual([
      {
        id: "s1",
        recipeLineId: "l1",
        ingredientId: "i3",
        createdAt: "2026-01-01T00:00:00Z",
        ingredientName: "Rice wine",
      },
    ]);
  });

  it("returns no Substitutes for a line that has none, without asking for other lines'", async () => {
    const client = makeFakeClient({
      data: [
        {
          id: "s1",
          recipe_line_id: "l1",
          ingredient_id: "i3",
          created_at: "2026-01-01T00:00:00Z",
          ingredients: { name: "Rice wine" },
        },
      ],
    });

    await expect(listSubstitutes(client, "l9")).resolves.toEqual([]);
  });

  it("adds a Substitute for one Recipe Line", async () => {
    const client = makeFakeClient({
      data: { id: "s2", recipe_line_id: "l1", ingredient_id: "i3", created_at: "2026-01-01T00:00:00Z" },
    });
    const result = await addSubstitute(client, "l1", "i3");
    expect(result.ingredientId).toBe("i3");
  });

  it("surfaces the database's rejection when the line is Essential", async () => {
    const client = makeFakeClient({
      error: { message: "Cannot add a Substitute to an Essential Recipe Line" },
    });
    await expect(addSubstitute(client, "l1", "i3")).rejects.toThrow("Essential Recipe Line");
  });

  it("removes a Substitute", async () => {
    const client = makeFakeClient({ error: null });
    await expect(removeSubstitute(client, "s1")).resolves.toBeUndefined();
  });
});

describe("listInconsistencies", () => {
  it("maps rows from recipe_line_inconsistencies", async () => {
    const client = makeFakeClient({
      data: [
        {
          recipe_line_id: "l2",
          recipe_id: "r1",
          reason: "unresolved_ingredient",
          line_label: "Leak",
        },
      ],
    });

    const result = await listInconsistencies(client, "r1");
    expect(result).toEqual([
      { recipeLineId: "l2", recipeId: "r1", reason: "unresolved_ingredient", lineLabel: "Leak" },
    ]);
  });
});

describe("listLineStatuses / getCookability", () => {
  it("maps rows from recipe_status", async () => {
    const client = makeFakeClient({
      data: [
        {
          recipe_line_id: "l1",
          recipe_id: "r1",
          ingredient_id: "i1",
          is_essential: false,
          status: "fulfilled_by_substitute",
        },
      ],
    });

    const result = await listLineStatuses(client, "r1");
    expect(result).toEqual([
      {
        recipeLineId: "l1",
        recipeId: "r1",
        ingredientId: "i1",
        isEssential: false,
        status: "fulfilled_by_substitute",
      },
    ]);
  });

  it("maps a row from recipe_cookability", async () => {
    const client = makeFakeClient({
      data: { recipe_id: "r1", name: "Stir-fry", is_cookable: true },
    });

    const result = await getCookability(client, "r1");
    expect(result).toEqual({ recipeId: "r1", name: "Stir-fry", isCookable: true });
  });

  it("returns null when the Recipe has no cookability row", async () => {
    const client = makeFakeClient({ data: null });
    const result = await getCookability(client, "missing");
    expect(result).toBeNull();
  });
});

describe("getRecipeWithLines", () => {
  it("returns null when the Recipe does not exist", async () => {
    const client = makeFakeClient({ data: null });
    const result = await getRecipeWithLines(client, "missing");
    expect(result).toBeNull();
  });
});
