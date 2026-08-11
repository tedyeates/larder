import { describe, expect, it, vi } from "vitest";
import { clearMealPlanSlot, saveMealPlanSlot, topUpMealPlanSlot } from "./plan";

function fakeClient() {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
  return { rpc } as unknown as import("@supabase/supabase-js").SupabaseClient;
}

describe("Meal Plan data access", () => {
  it("writes a Recipe Cook slot and never tops up automatically", async () => {
    const client = fakeClient();
    await saveMealPlanSlot(client, {
      slotDate: "2026-08-10", mealTime: "dinner", recipeId: "r1", isCook: true, cookMultiplier: 2,
    });
    expect(client.rpc).toHaveBeenCalledWith("set_meal_plan_slot", {
      p_slot_date: "2026-08-10", p_meal_time: "dinner", p_recipe_id: "r1", p_label: null,
      p_is_cook: true, p_cook_multiplier: 2,
    });
    expect(client.rpc).not.toHaveBeenCalledWith("top_up_meal_plan_slot", expect.anything());
  });

  it("only clears and tops up after an explicit gesture", async () => {
    const client = fakeClient();
    await clearMealPlanSlot(client, "slot-1");
    await topUpMealPlanSlot(client, "slot-2");
    expect(client.rpc).toHaveBeenCalledWith("clear_meal_plan_slot", { p_slot_id: "slot-1" });
    expect(client.rpc).toHaveBeenCalledWith("top_up_meal_plan_slot", { p_slot_id: "slot-2" });
  });
});
