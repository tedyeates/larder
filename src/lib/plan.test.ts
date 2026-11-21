import { describe, expect, it } from "vitest";
import { derivePlannedCooks, type PlanEntryView } from "./plan";

function entry(
  overrides: Partial<PlanEntryView> & Pick<PlanEntryView, "id" | "day" | "slot">,
): PlanEntryView {
  return {
    kind: "recipe",
    recipeId: "recipe-1",
    leftoverId: null,
    title: "Test",
    portions: 2,
    status: "planned",
    createdBy: "manual",
    ...overrides,
  };
}

describe("derivePlannedCooks", () => {
  it("leaves one portion per cook for the night it is cooked", () => {
    const cooks = derivePlannedCooks([entry({ id: "a", day: "2026-11-16", slot: "dinner" })]);
    expect(cooks[0]?.capacity).toBe(1);
    expect(cooks[0]?.cooks).toBe(1);
  });

  it("stacks two cooks of the same dish", () => {
    const cooks = derivePlannedCooks([
      entry({ id: "a", day: "2026-11-16", slot: "dinner" }),
      entry({ id: "b", day: "2026-11-18", slot: "dinner" }),
    ]);
    expect(cooks[0]?.portions).toBe(4);
    expect(cooks[0]?.cooks).toBe(2);
    expect(cooks[0]?.capacity).toBe(2);
  });

  it("counts planned leftovers against the capacity", () => {
    const cooks = derivePlannedCooks([
      entry({ id: "a", day: "2026-11-16", slot: "dinner" }),
      entry({
        id: "b",
        day: "2026-11-17",
        slot: "lunch",
        kind: "leftover",
        leftoverId: null,
        portions: 1,
      }),
    ]);
    expect(cooks[0]?.reserved).toBe(1);
    expect((cooks[0]?.capacity ?? 0) - (cooks[0]?.reserved ?? 0)).toBe(0);
  });

  it("ignores leftovers already backed by a batch", () => {
    const cooks = derivePlannedCooks([
      entry({ id: "a", day: "2026-11-16", slot: "dinner" }),
      entry({
        id: "b",
        day: "2026-11-17",
        slot: "lunch",
        kind: "leftover",
        leftoverId: "batch-1",
        portions: 1,
      }),
    ]);
    expect(cooks[0]?.reserved).toBe(0);
  });

  it("ignores cooked meals when counting the week's plan", () => {
    const cooks = derivePlannedCooks([
      entry({ id: "a", day: "2026-11-16", slot: "dinner", status: "cooked" }),
    ]);
    expect(cooks).toEqual([]);
  });

  it("tracks a main and a side in the same slot separately", () => {
    const cooks = derivePlannedCooks([
      entry({ id: "a", day: "2026-11-16", slot: "dinner", recipeId: "wings" }),
      entry({ id: "b", day: "2026-11-16", slot: "dinner", recipeId: "salad" }),
    ]);
    expect(cooks.map((cook) => cook.recipeId).sort()).toEqual(["salad", "wings"]);
    expect(cooks.every((cook) => cook.cooks === 1)).toBe(true);
  });

  it("never reports negative capacity for a one-portion cook", () => {
    const cooks = derivePlannedCooks([
      entry({ id: "a", day: "2026-11-16", slot: "dinner", portions: 1 }),
    ]);
    expect(cooks[0]?.capacity).toBe(0);
  });
});
