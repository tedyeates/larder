import { describe, expect, it, vi } from "vitest";
import {
  addAlias,
  addUnitConversion,
  convertToStockUnit,
  createIngredient,
  deleteIngredient,
  listAliases,
  listIngredients,
  listUnitConversions,
  removeAlias,
  removeUnitConversion,
  resolveIngredientName,
  setHandDepleted,
  updateIngredient,
} from "./registry";

/**
 * Minimal fake mirroring the slice of the Supabase JS client's fluent
 * query builder these functions call, plus `.rpc`. `.eq()` is both a
 * chain link (select/update chains continue to `.order()`/`.select()`)
 * and a terminal (bare `delete().eq()` awaits it directly) — the real
 * client achieves this by making the builder itself thenable; this fake
 * does the same by attaching `.then` to the builder.
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
  builder.order = vi.fn(() => Promise.resolve(terminal));
  builder.single = vi.fn(() => Promise.resolve(terminal));

  const from = vi.fn(() => builder);
  const rpc = vi.fn(() => Promise.resolve(terminal));

  return { from, rpc } as unknown as import("@supabase/supabase-js").SupabaseClient;
}

describe("listIngredients", () => {
  it("maps rows from snake_case to the domain shape", async () => {
    const client = makeFakeClient({
      data: [
        {
          id: "i1",
          name: "Oats",
          stock_unit: "g",
          is_hand_depleted: false,
          last_purchased_amount: "500",
          status: "active",
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
    });

    const result = await listIngredients(client);

    expect(result).toEqual([
      {
        id: "i1",
        name: "Oats",
        stockUnit: "g",
        isHandDepleted: false,
        lastPurchasedAmount: 500,
        status: "active",
        createdAt: "2026-01-01T00:00:00Z",
      },
    ]);
  });

  it("throws a clear error when the query fails", async () => {
    const client = makeFakeClient({ error: { message: "boom" } });
    await expect(listIngredients(client)).rejects.toThrow("boom");
  });
});

describe("createIngredient / updateIngredient / deleteIngredient", () => {
  it("creates an Ingredient from name and stock unit", async () => {
    const client = makeFakeClient({
      data: {
        id: "i2",
        name: "Chicken thighs",
        stock_unit: "pieces",
        is_hand_depleted: false,
        last_purchased_amount: null,
        status: "active",
        created_at: "2026-01-01T00:00:00Z",
      },
    });

    const result = await createIngredient(client, {
      name: "Chicken thighs",
      stockUnit: "pieces",
    });

    expect(result.name).toBe("Chicken thighs");
    expect(result.stockUnit).toBe("pieces");
    expect(result.lastPurchasedAmount).toBeNull();
  });

  it("updates an Ingredient's fields", async () => {
    const client = makeFakeClient({
      data: {
        id: "i2",
        name: "Chicken thighs",
        stock_unit: "pieces",
        is_hand_depleted: true,
        last_purchased_amount: null,
        status: "active",
        created_at: "2026-01-01T00:00:00Z",
      },
    });

    const result = await setHandDepleted(client, "i2", true);
    expect(result.isHandDepleted).toBe(true);
  });

  it("propagates a clear error on update failure", async () => {
    const client = makeFakeClient({ error: { message: "constraint violated" } });
    await expect(updateIngredient(client, "i2", { name: "" })).rejects.toThrow(
      "constraint violated"
    );
  });

  it("deletes an Ingredient", async () => {
    const client = makeFakeClient({ error: null });
    await expect(deleteIngredient(client, "i2")).resolves.toBeUndefined();
  });
});

describe("aliases", () => {
  it("lists aliases for an Ingredient", async () => {
    const client = makeFakeClient({
      data: [
        {
          id: "a1",
          ingredient_id: "i1",
          alias: "Leak",
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
    });

    const result = await listAliases(client, "i1");
    expect(result).toEqual([
      { id: "a1", ingredientId: "i1", alias: "Leak", createdAt: "2026-01-01T00:00:00Z" },
    ]);
  });

  it("adds an alias", async () => {
    const client = makeFakeClient({
      data: { id: "a2", ingredient_id: "i1", alias: "Chicken", created_at: "2026-01-01T00:00:00Z" },
    });
    const result = await addAlias(client, "i1", "Chicken");
    expect(result.alias).toBe("Chicken");
  });

  it("surfaces a collision error when an alias shadows an Ingredient name", async () => {
    const client = makeFakeClient({
      error: { message: 'Alias "Leek" collides with an existing Ingredient name' },
    });
    await expect(addAlias(client, "i1", "Leek")).rejects.toThrow("collides with an existing");
  });

  it("removes an alias", async () => {
    const client = makeFakeClient({ error: null });
    await expect(removeAlias(client, "a1")).resolves.toBeUndefined();
  });
});

describe("unit conversions", () => {
  it("lists conversions for an Ingredient", async () => {
    const client = makeFakeClient({
      data: [
        {
          id: "u1",
          ingredient_id: "i6",
          from_unit: "cup",
          factor_to_stock_unit: "120",
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
    });

    const result = await listUnitConversions(client, "i6");
    expect(result).toEqual([
      { id: "u1", ingredientId: "i6", fromUnit: "cup", factorToStockUnit: 120, createdAt: "2026-01-01T00:00:00Z" },
    ]);
  });

  it("adds a conversion factor", async () => {
    const client = makeFakeClient({
      data: {
        id: "u2",
        ingredient_id: "i6",
        from_unit: "cup",
        factor_to_stock_unit: "120",
        created_at: "2026-01-01T00:00:00Z",
      },
    });
    const result = await addUnitConversion(client, "i6", { fromUnit: "cup", factorToStockUnit: 120 });
    expect(result.factorToStockUnit).toBe(120);
  });

  it("removes a conversion factor", async () => {
    const client = makeFakeClient({ error: null });
    await expect(removeUnitConversion(client, "u1")).resolves.toBeUndefined();
  });
});

describe("resolveIngredientName", () => {
  it("resolves outright on an exact match", async () => {
    const client = makeFakeClient({
      data: [{ ingredient_id: "i1", name: "Leek", match_kind: "exact", score: 1 }],
    });

    const result = await resolveIngredientName(client, "Leek");
    expect(result).toEqual({ resolved: true, ingredientId: "i1", name: "Leek", matchKind: "exact" });
  });

  it("resolves outright on an alias match", async () => {
    const client = makeFakeClient({
      data: [{ ingredient_id: "i1", name: "Leek", match_kind: "alias", score: 1 }],
    });

    const result = await resolveIngredientName(client, "Leak");
    expect(result).toEqual({ resolved: true, ingredientId: "i1", name: "Leek", matchKind: "alias" });
  });

  it("returns ranked candidates rather than resolving on fuzzy matches", async () => {
    const client = makeFakeClient({
      data: [
        { ingredient_id: "i2", name: "Chicken thighs", match_kind: "fuzzy", score: 0.8 },
        { ingredient_id: "i9", name: "Chickpeas", match_kind: "fuzzy", score: 0.4 },
      ],
    });

    const result = await resolveIngredientName(client, "Chikken thighs");
    expect(result.resolved).toBe(false);
    if (!result.resolved) {
      expect(result.candidates).toHaveLength(2);
      expect(result.candidates[0]).toEqual({
        ingredientId: "i2",
        name: "Chicken thighs",
        matchKind: "fuzzy",
        score: 0.8,
      });
    }
  });

  it("returns an empty candidate list when nothing matches", async () => {
    const client = makeFakeClient({ data: [] });
    const result = await resolveIngredientName(client, "xyzzy");
    expect(result).toEqual({ resolved: false, candidates: [] });
  });
});

describe("convertToStockUnit", () => {
  it("returns the converted amount when a factor exists", async () => {
    const client = makeFakeClient({ data: 120 });
    const result = await convertToStockUnit(client, "i6", 1, "cup");
    expect(result).toBe(120);
  });

  it("throws the database's clear reason when no factor exists", async () => {
    const client = makeFakeClient({
      error: { message: 'No Convertible Unit factor from "handful" to Stock Unit "g" for this Ingredient' },
    });
    await expect(convertToStockUnit(client, "i6", 1, "handful")).rejects.toThrow(
      "No Convertible Unit factor"
    );
  });
});
