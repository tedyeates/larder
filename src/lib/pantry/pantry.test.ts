import { describe, expect, it, vi } from "vitest";
import {
  addStock,
  consumeStock,
  deleteStockLot,
  listPantrySummary,
  listStockLots,
  setHandDepletedFraction,
  updateStockLot,
} from "./pantry";

/**
 * Minimal fake mirroring the slice of the Supabase JS client's fluent
 * query builder these functions call, plus `.rpc`. Mirrors
 * src/lib/ingredients/registry.test.ts's fake.
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

  return { from, rpc } as unknown as import("@supabase/supabase-js").SupabaseClient;
}

describe("listPantrySummary", () => {
  it("maps rows from snake_case to the domain shape", async () => {
    const client = makeFakeClient({
      data: [
        {
          ingredient_id: "i1",
          ingredient_name: "Chicken thighs",
          stock_unit: "pieces",
          is_hand_depleted: false,
          storage_location: "fridge",
          total_quantity: "6",
          oldest_acquired_on: "2026-01-01",
          lot_count: "2",
        },
      ],
    });

    const result = await listPantrySummary(client);

    expect(result).toEqual([
      {
        ingredientId: "i1",
        ingredientName: "Chicken thighs",
        stockUnit: "pieces",
        isHandDepleted: false,
        storageLocation: "fridge",
        totalQuantity: 6,
        oldestAcquiredOn: "2026-01-01",
        lotCount: 2,
      },
    ]);
  });

  it("throws a clear error when the query fails", async () => {
    const client = makeFakeClient({ error: { message: "boom" } });
    await expect(listPantrySummary(client)).rejects.toThrow("boom");
  });
});

describe("listStockLots", () => {
  it("maps Lot rows oldest first", async () => {
    const client = makeFakeClient({
      data: [
        {
          id: "l1",
          ingredient_id: "i1",
          quantity: "4",
          storage_location: "fridge",
          acquired_on: "2026-01-01",
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
    });

    const result = await listStockLots(client, "i1");
    expect(result).toEqual([
      {
        id: "l1",
        ingredientId: "i1",
        quantity: 4,
        storageLocation: "fridge",
        acquiredOn: "2026-01-01",
        createdAt: "2026-01-01T00:00:00Z",
      },
    ]);
  });
});

describe("addStock", () => {
  it("calls add_stock_lot with the given fields", async () => {
    const client = makeFakeClient({
      data: {
        id: "l1",
        ingredient_id: "i1",
        quantity: "4",
        storage_location: "fridge",
        acquired_on: "2026-01-01",
        created_at: "2026-01-01T00:00:00Z",
      },
    });

    const result = await addStock(client, {
      ingredientId: "i1",
      quantity: 4,
      storageLocation: "fridge",
      acquiredOn: "2026-01-01",
    });

    expect(client.rpc).toHaveBeenCalledWith("add_stock_lot", {
      p_ingredient_id: "i1",
      p_quantity: 4,
      p_storage_location: "fridge",
      p_acquired_on: "2026-01-01",
    });
    expect(result.quantity).toBe(4);
  });

  it("omits acquiredOn when not given, letting the database default to today", async () => {
    const client = makeFakeClient({
      data: {
        id: "l1",
        ingredient_id: "i1",
        quantity: "4",
        storage_location: "fridge",
        acquired_on: "2026-01-01",
        created_at: "2026-01-01T00:00:00Z",
      },
    });

    await addStock(client, { ingredientId: "i1", quantity: 4, storageLocation: "fridge" });

    expect(client.rpc).toHaveBeenCalledWith("add_stock_lot", {
      p_ingredient_id: "i1",
      p_quantity: 4,
      p_storage_location: "fridge",
    });
  });

  it("propagates a clear error on failure", async () => {
    const client = makeFakeClient({ error: { message: "add_stock_lot requires a positive quantity" } });
    await expect(
      addStock(client, { ingredientId: "i1", quantity: 0, storageLocation: "fridge" })
    ).rejects.toThrow("positive quantity");
  });
});

describe("consumeStock", () => {
  it("returns the requested/consumed/shortfall report", async () => {
    const client = makeFakeClient({
      data: { ingredient_id: "i1", requested: "10", consumed: "3", shortfall: "7" },
    });

    const result = await consumeStock(client, "i1", 10);

    expect(client.rpc).toHaveBeenCalledWith("consume_stock", {
      p_ingredient_id: "i1",
      p_quantity: 10,
    });
    expect(result).toEqual({ ingredientId: "i1", requested: 10, consumed: 3, shortfall: 7 });
  });

  it("propagates a clear error when the Ingredient is Hand-Depleted", async () => {
    const client = makeFakeClient({
      error: { message: "Ingredient i5 is Hand-Depleted and cannot be automatically consumed" },
    });
    await expect(consumeStock(client, "i5", 1)).rejects.toThrow("Hand-Depleted");
  });
});

describe("setHandDepletedFraction", () => {
  it("sets the fraction for a Storage Location and day", async () => {
    const client = makeFakeClient({
      data: {
        id: "l1",
        ingredient_id: "i5",
        quantity: "0.5",
        storage_location: "cupboard",
        acquired_on: "2026-01-01",
        created_at: "2026-01-01T00:00:00Z",
      },
    });

    const result = await setHandDepletedFraction(client, {
      ingredientId: "i5",
      quantity: 0.5,
      storageLocation: "cupboard",
      acquiredOn: "2026-01-01",
    });

    expect(client.rpc).toHaveBeenCalledWith("set_hand_depleted_fraction", {
      p_ingredient_id: "i5",
      p_quantity: 0.5,
      p_storage_location: "cupboard",
      p_acquired_on: "2026-01-01",
    });
    expect(result?.quantity).toBe(0.5);
  });

  it("returns null when setting to zero removes the Lot", async () => {
    const client = makeFakeClient({ data: null });
    const result = await setHandDepletedFraction(client, {
      ingredientId: "i5",
      quantity: 0,
      storageLocation: "cupboard",
    });
    expect(result).toBeNull();
  });
});

describe("updateStockLot / deleteStockLot", () => {
  it("updates a Lot's quantity by hand", async () => {
    const client = makeFakeClient({
      data: {
        id: "l1",
        ingredient_id: "i1",
        quantity: "9",
        storage_location: "fridge",
        acquired_on: "2026-01-01",
        created_at: "2026-01-01T00:00:00Z",
      },
    });

    const result = await updateStockLot(client, "l1", { quantity: 9 });
    expect(result.quantity).toBe(9);
  });

  it("deletes a Lot by hand", async () => {
    const client = makeFakeClient({ error: null });
    await expect(deleteStockLot(client, "l1")).resolves.toBeUndefined();
  });

  it("propagates a clear error on delete failure", async () => {
    const client = makeFakeClient({ error: { message: "not found" } });
    await expect(deleteStockLot(client, "missing")).rejects.toThrow("not found");
  });
});
