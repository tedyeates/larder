import { describe, expect, it, vi } from "vitest";
import {
  addPortionBatch,
  commitCook,
  eatPortion,
  listMealStock,
  previewCook,
  recordAteOut,
} from "./meals";

function makeFakeClient(result: { data?: unknown; error?: { message: string } | null }) {
  const terminal = { data: result.data ?? null, error: result.error ?? null };
  const builder: Record<string, unknown> = { then: (resolve: (value: typeof terminal) => void) => resolve(terminal) };
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

const preview = {
  recipe_id: "r1",
  multiplier: 2,
  lines: [{ recipe_line_id: "l1", ingredient_name: "Chicken", requested: 4, will_deplete: 3, shortfall: 1, substitutes: [] }],
};

describe("Cook and Meal Stock data access", () => {
  it("maps preview data and sends Substitute choices to shared preview RPC", async () => {
    const client = makeFakeClient({ data: preview });
    await expect(previewCook(client, { recipeId: "r1", multiplier: 2, substitutions: [{ recipeLineId: "l1", substituteIngredientId: "i2" }] })).resolves.toEqual(expect.objectContaining({ multiplier: 2 }));
    expect(client.rpc).toHaveBeenCalledWith("preview_cook", {
      p_recipe_id: "r1", p_multiplier: 2,
      p_substitutions: [{ recipe_line_id: "l1", substitute_ingredient_id: "i2" }],
    });
  });

  it("commits through Cook RPC and returns its own discrepancy warning", async () => {
    const client = makeFakeClient({ data: { ...preview, cook_id: "c1", portion_batch_id: "b1" } });
    const result = await commitCook(client, { recipeId: "r1", multiplier: 2, cookedOn: "2026-08-03", substitutions: [] });
    expect(result.lines[0].shortfall).toBe(1);
    expect(client.rpc).toHaveBeenCalledWith("commit_cook", expect.objectContaining({ p_recipe_id: "r1", p_cooked_on: "2026-08-03" }));
  });

  it("lists Meal Stock with numeric counts and oldest Batch age", async () => {
    const client = makeFakeClient({ data: [{ recipe_id: "r1", label: null, display_name: "Chicken bowl", total_portions: "4", oldest_cooked_on: "2026-08-01", batch_count: "2" }] });
    await expect(listMealStock(client)).resolves.toEqual([{ recipeId: "r1", label: null, displayName: "Chicken bowl", totalPortions: 4, oldestCookedOn: "2026-08-01", batchCount: 2 }]);
  });

  it("adds, eats and records Ate Out through transition RPCs", async () => {
    const client = makeFakeClient({ data: { id: "b1", recipe_id: null, label: "Soup", portions_remaining: 2, storage_location: "fridge", cooked_on: "2026-08-03", created_at: "2026-08-03T00:00:00Z" } });
    await addPortionBatch(client, { label: "Soup", portions: 2, storageLocation: "fridge", cookedOn: "2026-08-03" });
    await eatPortion(client, { portionBatchId: "b1", occurredOn: "2026-08-03" });
    await recordAteOut(client, { description: "Restaurant", occurredOn: "2026-08-03" });
    expect(client.rpc).toHaveBeenCalledWith("add_portion_batch", expect.objectContaining({ p_label: "Soup" }));
    expect(client.rpc).toHaveBeenCalledWith("eat_portion", expect.objectContaining({ p_portion_batch_id: "b1" }));
    expect(client.rpc).toHaveBeenCalledWith("record_ate_out", expect.objectContaining({ p_description: "Restaurant" }));
  });
});
