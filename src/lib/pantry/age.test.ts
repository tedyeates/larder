import { describe, expect, it } from "vitest";
import { ageBadge } from "./age";

const NOW = new Date("2026-01-15T12:00:00Z");

describe("ageBadge", () => {
  it("is fresh for stock acquired today", () => {
    expect(ageBadge("2026-01-15", "fridge", NOW)).toEqual({ ageDays: 0, level: "fresh" });
  });

  it("is aging once past half the Fridge threshold (~4 days)", () => {
    expect(ageBadge("2026-01-13", "fridge", NOW)).toEqual({ ageDays: 2, level: "aging" });
  });

  it("is old once at or past the Fridge threshold (~4 days)", () => {
    expect(ageBadge("2026-01-11", "fridge", NOW)).toEqual({ ageDays: 4, level: "old" });
  });

  it("uses a longer threshold for Cupboard (~10 days)", () => {
    expect(ageBadge("2026-01-11", "cupboard", NOW)).toEqual({ ageDays: 4, level: "fresh" });
    expect(ageBadge("2026-01-05", "cupboard", NOW)).toEqual({ ageDays: 10, level: "old" });
  });

  it("never flags Freezer stock as aging or old", () => {
    expect(ageBadge("2020-01-01", "freezer", NOW)).toEqual({
      ageDays: expect.any(Number),
      level: "fresh",
    });
  });
});
