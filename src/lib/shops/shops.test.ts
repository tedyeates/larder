import { describe, expect, it, vi } from "vitest";
import {
  addPlacement,
  createAisle,
  createShop,
  deleteAisle,
  deleteShop,
  listAisles,
  listPlacementsForAisle,
  listPlacementsForIngredient,
  listShops,
  removePlacement,
  renameShop,
  reorderAisles,
  reorderShops,
  updateAisle,
} from "./shops";

/**
 * Minimal fake mirroring the slice of the Supabase JS client's fluent
 * query builder these functions call, plus `.rpc`. Mirrors
 * src/lib/pantry/pantry.test.ts's fake.
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
  builder.order = vi.fn(() => builder);
  builder.single = vi.fn(() => Promise.resolve(terminal));

  const from = vi.fn(() => builder);
  const rpc = vi.fn(() => Promise.resolve(terminal));

  return { from, rpc, __builder: builder, __rpc: rpc } as unknown as import("@supabase/supabase-js").SupabaseClient & {
    __builder: Record<string, unknown>;
    __rpc: ReturnType<typeof vi.fn>;
  };
}

describe("listShops", () => {
  it("maps rows from snake_case to the domain shape, ordered by position", async () => {
    const client = makeFakeClient({
      data: [
        { id: "s1", name: "Lidl", position: 0, created_at: "2026-01-01T00:00:00Z" },
        { id: "s2", name: "Asian Supermarket", position: 1, created_at: "2026-01-01T00:00:00Z" },
      ],
    });

    const result = await listShops(client);

    expect(result).toEqual([
      { id: "s1", name: "Lidl", position: 0, createdAt: "2026-01-01T00:00:00Z" },
      { id: "s2", name: "Asian Supermarket", position: 1, createdAt: "2026-01-01T00:00:00Z" },
    ]);
  });

  it("throws with the database error message on failure", async () => {
    const client = makeFakeClient({ error: { message: "boom" } });

    await expect(listShops(client)).rejects.toThrow("boom");
  });
});

describe("createShop", () => {
  it("calls create_shop and maps the returned row", async () => {
    const client = makeFakeClient({
      data: { id: "s1", name: "Lidl", position: 0, created_at: "2026-01-01T00:00:00Z" },
    });

    const result = await createShop(client, "Lidl");

    expect(client.rpc).toHaveBeenCalledWith("create_shop", { p_name: "Lidl" });
    expect(result).toEqual({ id: "s1", name: "Lidl", position: 0, createdAt: "2026-01-01T00:00:00Z" });
  });
});

describe("renameShop", () => {
  it("updates the name column and maps the returned row", async () => {
    const client = makeFakeClient({
      data: { id: "s1", name: "Lidl UK", position: 0, created_at: "2026-01-01T00:00:00Z" },
    });

    const result = await renameShop(client, "s1", "Lidl UK");

    expect(client.from).toHaveBeenCalledWith("shops");
    expect(result.name).toBe("Lidl UK");
  });
});

describe("reorderShops", () => {
  it("calls reorder_shops with the full ordered id list", async () => {
    const client = makeFakeClient({ data: null });

    await reorderShops(client, ["s2", "s1"]);

    expect(client.rpc).toHaveBeenCalledWith("reorder_shops", { p_shop_ids: ["s2", "s1"] });
  });

  it("throws with the database error message on failure", async () => {
    const client = makeFakeClient({ error: { message: "one or more ids did not match" } });

    await expect(reorderShops(client, ["s1"])).rejects.toThrow("one or more ids did not match");
  });
});

describe("deleteShop", () => {
  it("deletes by id", async () => {
    const client = makeFakeClient({ data: null });

    await deleteShop(client, "s1");

    expect(client.from).toHaveBeenCalledWith("shops");
  });
});

describe("listAisles", () => {
  it("reads from shop_aisles filtered by shop and mapped to the domain shape", async () => {
    const client = makeFakeClient({
      data: [
        {
          aisle_id: "a1",
          shop_id: "s1",
          name: "Dry Goods",
          emoji: "🍚",
          position: 0,
          placement_count: "3",
        },
      ],
    });

    const result = await listAisles(client, "s1");

    expect(client.from).toHaveBeenCalledWith("shop_aisles");
    expect(result).toEqual([
      {
        id: "a1",
        shopId: "s1",
        name: "Dry Goods",
        emoji: "🍚",
        position: 0,
        createdAt: "",
        placementCount: 3,
      },
    ]);
  });
});

describe("createAisle", () => {
  it("calls create_aisle with shop id, name and emoji", async () => {
    const client = makeFakeClient({
      data: {
        id: "a1",
        shop_id: "s1",
        name: "Dry Goods",
        emoji: "🍚",
        position: 0,
        created_at: "2026-01-01T00:00:00Z",
      },
    });

    const result = await createAisle(client, { shopId: "s1", name: "Dry Goods", emoji: "🍚" });

    expect(client.rpc).toHaveBeenCalledWith("create_aisle", {
      p_shop_id: "s1",
      p_name: "Dry Goods",
      p_emoji: "🍚",
    });
    expect(result.name).toBe("Dry Goods");
  });
});

describe("updateAisle", () => {
  it("only patches provided fields", async () => {
    const client = makeFakeClient({
      data: {
        id: "a1",
        shop_id: "s1",
        name: "Dry Goods",
        emoji: "🍞",
        position: 0,
        created_at: "2026-01-01T00:00:00Z",
      },
    });

    const result = await updateAisle(client, "a1", { emoji: "🍞" });

    expect(client.__builder.update).toHaveBeenCalledWith({ emoji: "🍞" });
    expect(result.emoji).toBe("🍞");
  });
});

describe("reorderAisles", () => {
  it("calls reorder_aisles with the shop id and full ordered id list", async () => {
    const client = makeFakeClient({ data: null });

    await reorderAisles(client, "s1", ["a2", "a1"]);

    expect(client.rpc).toHaveBeenCalledWith("reorder_aisles", {
      p_shop_id: "s1",
      p_aisle_ids: ["a2", "a1"],
    });
  });
});

describe("deleteAisle", () => {
  it("deletes by id", async () => {
    const client = makeFakeClient({ data: null });

    await deleteAisle(client, "a1");

    expect(client.from).toHaveBeenCalledWith("aisles");
  });
});

describe("listPlacementsForIngredient", () => {
  it("maps joined rows into flattened location fields", async () => {
    const client = makeFakeClient({
      data: [
        {
          id: "p1",
          ingredient_id: "i1",
          aisle_id: "a1",
          created_at: "2026-01-01T00:00:00Z",
          aisles: { name: "Dry Goods", emoji: "🍚", shop_id: "s1", shops: { name: "Lidl" } },
        },
        {
          id: "p2",
          ingredient_id: "i1",
          aisle_id: "a2",
          created_at: "2026-01-01T00:00:00Z",
          aisles: {
            name: "Noodles & Rice",
            emoji: "🍜",
            shop_id: "s2",
            shops: { name: "Asian Supermarket" },
          },
        },
      ],
    });

    const result = await listPlacementsForIngredient(client, "i1");

    expect(result).toEqual([
      {
        id: "p1",
        ingredientId: "i1",
        aisleId: "a1",
        createdAt: "2026-01-01T00:00:00Z",
        aisleName: "Dry Goods",
        aisleEmoji: "🍚",
        shopId: "s1",
        shopName: "Lidl",
      },
      {
        id: "p2",
        ingredientId: "i1",
        aisleId: "a2",
        createdAt: "2026-01-01T00:00:00Z",
        aisleName: "Noodles & Rice",
        aisleEmoji: "🍜",
        shopId: "s2",
        shopName: "Asian Supermarket",
      },
    ]);
  });
});

describe("listPlacementsForAisle", () => {
  it("maps rows from snake_case to the domain shape", async () => {
    const client = makeFakeClient({
      data: [{ id: "p1", ingredient_id: "i1", aisle_id: "a1", created_at: "2026-01-01T00:00:00Z" }],
    });

    const result = await listPlacementsForAisle(client, "a1");

    expect(result).toEqual([
      { id: "p1", ingredientId: "i1", aisleId: "a1", createdAt: "2026-01-01T00:00:00Z" },
    ]);
  });
});

describe("addPlacement", () => {
  it("calls set_placement with ingredient and aisle ids", async () => {
    const client = makeFakeClient({
      data: { id: "p1", ingredient_id: "i1", aisle_id: "a1", created_at: "2026-01-01T00:00:00Z" },
    });

    const result = await addPlacement(client, { ingredientId: "i1", aisleId: "a1" });

    expect(client.rpc).toHaveBeenCalledWith("set_placement", {
      p_ingredient_id: "i1",
      p_aisle_id: "a1",
    });
    expect(result).toEqual({ id: "p1", ingredientId: "i1", aisleId: "a1", createdAt: "2026-01-01T00:00:00Z" });
  });
});

describe("removePlacement", () => {
  it("calls remove_placement with ingredient and aisle ids", async () => {
    const client = makeFakeClient({ data: null });

    await removePlacement(client, { ingredientId: "i1", aisleId: "a1" });

    expect(client.rpc).toHaveBeenCalledWith("remove_placement", {
      p_ingredient_id: "i1",
      p_aisle_id: "a1",
    });
  });

  it("throws with the database error message on failure", async () => {
    const client = makeFakeClient({ error: { message: "boom" } });

    await expect(removePlacement(client, { ingredientId: "i1", aisleId: "a1" })).rejects.toThrow(
      "boom"
    );
  });
});
