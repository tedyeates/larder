import { describe, expect, it } from "vitest";
import { addDays, daysBetween, startOfWeek } from "./dates";
import {
  balance,
  earliestBestBefore,
  expiryState,
  planDeduction,
  remainingLots,
  type StockEntry,
} from "./ledger";

function entry(overrides: Partial<StockEntry> & Pick<StockEntry, "id" | "quantity">): StockEntry {
  return {
    ingredientId: "rice",
    acquiredAt: "2026-11-01",
    reason: "purchase",
    bestBefore: null,
    ...overrides,
  };
}

describe("balance", () => {
  it("is the sum of every entry, signed", () => {
    const entries = [
      entry({ id: "a", quantity: 1000 }),
      entry({ id: "b", quantity: 500 }),
      entry({ id: "c", quantity: -300, reason: "cook" }),
    ];
    expect(balance(entries)).toBe(1200);
  });

  it("is zero for no entries", () => {
    expect(balance([])).toBe(0);
  });

  it("keeps fractional precision honest", () => {
    expect(balance([entry({ id: "a", quantity: 0.1 }), entry({ id: "b", quantity: 0.2 })])).toBe(
      0.3,
    );
  });
});

describe("remainingLots", () => {
  it("consumes the oldest lot first", () => {
    const entries = [
      entry({ id: "new", quantity: 500, acquiredAt: "2026-11-10" }),
      entry({ id: "old", quantity: 400, acquiredAt: "2026-11-01" }),
      entry({ id: "cook", quantity: -600, reason: "cook", acquiredAt: "2026-11-11" }),
    ];
    const lots = remainingLots(entries);
    expect(lots).toHaveLength(1);
    expect(lots[0]?.entryId).toBe("new");
    expect(lots[0]?.quantity).toBe(300);
  });

  it("splits a deduction across lots", () => {
    const lots = remainingLots([
      entry({ id: "a", quantity: 200, acquiredAt: "2026-11-01" }),
      entry({ id: "b", quantity: 200, acquiredAt: "2026-11-02" }),
      entry({ id: "cook", quantity: -350, reason: "cook" }),
    ]);
    expect(lots.map((lot) => [lot.entryId, lot.quantity])).toEqual([["b", 50]]);
  });

  it("prefers the earlier best-before when lots arrived the same day", () => {
    const lots = remainingLots([
      entry({ id: "later", quantity: 100, bestBefore: "2026-12-01" }),
      entry({ id: "sooner", quantity: 100, bestBefore: "2026-11-20" }),
      entry({ id: "cook", quantity: -100, reason: "cook" }),
    ]);
    expect(lots.map((lot) => lot.entryId)).toEqual(["later"]);
  });

  it("treats a stock addition as a lot too", () => {
    const lots = remainingLots([
      entry({ id: "purchase", quantity: 100 }),
      entry({ id: "adjust", quantity: 250, reason: "adjust" }),
    ]);
    expect(lots.reduce((total, lot) => total + lot.quantity, 0)).toBe(350);
  });
});

describe("earliestBestBefore", () => {
  it("ignores empty lots", () => {
    const entries = [
      entry({ id: "used", quantity: 100, bestBefore: "2026-11-10" }),
      entry({ id: "left", quantity: 100, bestBefore: "2026-11-25" }),
      entry({ id: "cook", quantity: -100, reason: "cook" }),
    ];
    expect(earliestBestBefore(entries)).toBe("2026-11-25");
  });

  it("returns null when nothing is dated", () => {
    expect(earliestBestBefore([entry({ id: "a", quantity: 100 })])).toBeNull();
  });
});

describe("expiryState", () => {
  const today = "2026-11-15";
  it("classifies dates against today", () => {
    expect(expiryState(null, today)).toBe("none");
    expect(expiryState("2026-11-14", today)).toBe("expired");
    expect(expiryState("2026-11-17", today)).toBe("soon");
    expect(expiryState("2026-11-30", today)).toBe("ok");
  });
});

describe("planDeduction", () => {
  it("draws oldest first and reports what was taken", () => {
    const entries = [
      entry({ id: "old", quantity: 200, acquiredAt: "2026-11-01" }),
      entry({ id: "new", quantity: 300, acquiredAt: "2026-11-05" }),
    ];
    const result = planDeduction(entries, 350);
    expect(result.consumptions).toEqual([
      { entryId: "old", amount: 200 },
      { entryId: "new", amount: 150 },
    ]);
    expect(result.deducted).toBe(350);
    expect(result.shortfall).toBe(0);
    expect(result.available).toBe(500);
  });

  it("deducts what exists and reports the gap", () => {
    const result = planDeduction([entry({ id: "a", quantity: 120 })], 200);
    expect(result.consumptions).toEqual([{ entryId: "a", amount: 120 }]);
    expect(result.deducted).toBe(120);
    expect(result.shortfall).toBe(80);
  });

  it("has nothing to deduct when the pantry is empty", () => {
    const result = planDeduction([], 200);
    expect(result.consumptions).toEqual([]);
    expect(result.shortfall).toBe(200);
    expect(result.available).toBe(0);
  });

  it("ignores a non-positive requirement", () => {
    const result = planDeduction([entry({ id: "a", quantity: 100 })], 0);
    expect(result.deducted).toBe(0);
    expect(result.shortfall).toBe(0);
  });

  it("never consumes more than a lot holds", () => {
    const result = planDeduction(
      [entry({ id: "a", quantity: 100 }), entry({ id: "b", quantity: 100 })],
      150,
    );
    expect(result.consumptions.map((c) => c.amount)).toEqual([100, 50]);
  });
});

describe("dates", () => {
  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-11-28", 5)).toBe("2026-12-03");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("counts whole days between dates", () => {
    expect(daysBetween("2026-11-15", "2026-11-18")).toBe(3);
    expect(daysBetween("2026-11-18", "2026-11-15")).toBe(-3);
  });

  it("finds Monday for a week", () => {
    expect(startOfWeek("2026-11-15")).toBe("2026-11-09");
    expect(startOfWeek("2026-11-09")).toBe("2026-11-09");
  });
});
