import { describe, expect, it } from "vitest";
import type { StockEntry } from "./ledger";
import { pantryStatus, statusLabel, statusRank } from "./status";

const today = "2026-11-15";

function stock(quantity: number, bestBefore: string | null = null): StockEntry {
  return {
    id: `lot-${quantity}-${bestBefore ?? "none"}`,
    ingredientId: "rice",
    quantity,
    acquiredAt: "2026-11-01",
    bestBefore,
    reason: "purchase",
  };
}

describe("pantryStatus", () => {
  it("is out at zero", () => {
    const status = pantryStatus({ entries: [], today });
    expect(status.out).toBe(true);
    expect(status.onHand).toBe(0);
  });

  it("is out when deductions exceed stock", () => {
    const entries: StockEntry[] = [
      stock(100),
      {
        id: "cook",
        ingredientId: "rice",
        quantity: -100,
        acquiredAt: "2026-11-02",
        reason: "cook",
      },
    ];
    expect(pantryStatus({ entries, today }).out).toBe(true);
  });

  it("is low at or below an explicit minimum", () => {
    expect(pantryStatus({ entries: [stock(100)], today, minStock: 100 }).low).toBe(true);
    expect(pantryStatus({ entries: [stock(300)], today, minStock: 100 }).low).toBe(false);
  });

  it("is low when the rest of the week needs more than is on hand", () => {
    expect(pantryStatus({ entries: [stock(200)], today, weekRequirement: 350 }).low).toBe(true);
    expect(pantryStatus({ entries: [stock(400)], today, weekRequirement: 350 }).low).toBe(false);
  });

  it("is not low with no plan and no minimum", () => {
    expect(pantryStatus({ entries: [stock(50)], today }).low).toBe(false);
  });

  it("flags stock turning within three days", () => {
    const status = pantryStatus({ entries: [stock(100, "2026-11-17")], today });
    expect(status.useSoon).toBe(true);
    expect(status.daysUntilExpiry).toBe(2);
  });

  it("does not flag stock with a distant date", () => {
    expect(pantryStatus({ entries: [stock(100, "2026-12-24")], today }).useSoon).toBe(false);
  });

  it("flags already-expired stock separately", () => {
    const status = pantryStatus({ entries: [stock(100, "2026-11-10")], today });
    expect(status.expired).toBe(true);
    expect(status.useSoon).toBe(false);
  });

  it("does not flag a dated but empty lot", () => {
    const entries: StockEntry[] = [
      stock(100, "2026-11-10"),
      {
        id: "cook",
        ingredientId: "rice",
        quantity: -100,
        acquiredAt: "2026-11-02",
        reason: "cook",
      },
    ];
    const status = pantryStatus({ entries, today });
    expect(status.earliestBestBefore).toBeNull();
    expect(status.expired).toBe(false);
  });

  it("uses the soonest date among remaining lots", () => {
    const entries = [stock(100, "2026-11-30"), stock(100, "2026-11-18")];
    expect(pantryStatus({ entries, today }).earliestBestBefore).toBe("2026-11-18");
  });

  it("can be both use-soon and low", () => {
    const status = pantryStatus({
      entries: [stock(100, "2026-11-16")],
      today,
      minStock: 200,
    });
    expect(status.useSoon).toBe(true);
    expect(status.low).toBe(true);
  });
});

describe("presentation", () => {
  it("ranks out before use-soon before low", () => {
    expect(statusRank(pantryStatus({ entries: [], today }))).toBe(0);
    expect(statusRank(pantryStatus({ entries: [stock(100, "2026-11-16")], today }))).toBe(1);
    expect(statusRank(pantryStatus({ entries: [stock(100)], today, minStock: 500 }))).toBe(2);
    expect(statusRank(pantryStatus({ entries: [stock(500, "2026-12-01")], today }))).toBe(3);
  });

  it("labels a row for the chip", () => {
    expect(statusLabel(pantryStatus({ entries: [], today }))).toBe("Out");
    expect(statusLabel(pantryStatus({ entries: [stock(100, "2026-11-16")], today }))).toBe(
      "Use soon",
    );
    expect(statusLabel(pantryStatus({ entries: [stock(100)], today, minStock: 500 }))).toBe("Low");
    expect(statusLabel(pantryStatus({ entries: [stock(900)], today }))).toBe("OK");
  });
});
