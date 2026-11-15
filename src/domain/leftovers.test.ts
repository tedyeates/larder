import { describe, expect, it } from "vitest";
import { consumePortions, DEFAULT_LEFTOVER_DAYS, leftoverUseBy, splitPortions } from "./leftovers";

describe("splitPortions", () => {
  it("turns uneaten portions into leftovers", () => {
    expect(splitPortions(4, 1)).toEqual({ portionsCooked: 4, eatenNow: 1, leftoverPortions: 3 });
  });

  it("leaves no leftovers when everything is eaten", () => {
    expect(splitPortions(2, 2).leftoverPortions).toBe(0);
  });

  it("clamps eating more than was cooked", () => {
    expect(splitPortions(2, 5)).toEqual({ portionsCooked: 2, eatenNow: 2, leftoverPortions: 0 });
  });

  it("clamps negative input", () => {
    expect(splitPortions(-3, -1)).toEqual({ portionsCooked: 0, eatenNow: 0, leftoverPortions: 0 });
  });

  it("supports half portions", () => {
    expect(splitPortions(2.5, 1.5).leftoverPortions).toBe(1);
  });
});

describe("leftoverUseBy", () => {
  it("defaults to three days", () => {
    expect(DEFAULT_LEFTOVER_DAYS).toBe(3);
    expect(leftoverUseBy("2026-11-15")).toBe("2026-11-18");
  });

  it("crosses month boundaries", () => {
    expect(leftoverUseBy("2026-11-29")).toBe("2026-12-02");
  });

  it("accepts a custom window", () => {
    expect(leftoverUseBy("2026-11-15", 5)).toBe("2026-11-20");
  });
});

describe("consumePortions", () => {
  it("takes part of a batch", () => {
    expect(consumePortions(3, 2)).toEqual({ taken: 2, remaining: 1 });
  });

  it("takes everything", () => {
    expect(consumePortions(2, 2)).toEqual({ taken: 2, remaining: 0 });
  });

  it("never takes more than exists", () => {
    expect(consumePortions(1, 5)).toEqual({ taken: 1, remaining: 0 });
  });

  it("ignores a negative take", () => {
    expect(consumePortions(2, -1)).toEqual({ taken: 0, remaining: 2 });
  });
});
