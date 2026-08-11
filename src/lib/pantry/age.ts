import type { StorageLocation } from "./types";

/**
 * Age badge thresholds, in days, per Storage Location. Advisory only —
 * never blocking, per .kiro/specs/larder-core/design.md ("Storage
 * Locations carry their own age thresholds for badges: Fridge Portions
 * warn at roughly four days, fresh produce at ten, Freezer effectively
 * never").
 *
 * The design note is written in terms of Fridge Portions versus fresh
 * produce, a distinction Ingredients don't yet carry a field for. Until
 * an Ingredient-level "is produce" concept exists, Fridge uses the
 * tighter four-day threshold (matching cooked/perishable portions, the
 * more common case for what actually lives there) and every other
 * non-Freezer location uses the ten-day produce-like threshold. Freezer
 * is `null`, meaning no threshold ever fires.
 */
const AGE_THRESHOLD_DAYS: Record<StorageLocation, number | null> = {
  fridge: 4,
  freezer: null,
  cupboard: 10,
  counter: 10,
  household: 10,
  medicine: 10,
};

export type AgeBadgeLevel = "fresh" | "aging" | "old";

export type AgeBadge = {
  ageDays: number;
  level: AgeBadgeLevel;
};

/**
 * Derives an age badge from the oldest Lot's acquired_on date and its
 * Storage Location's threshold. `old` once age reaches the threshold,
 * `aging` from halfway there, `fresh` otherwise. Freezer never returns
 * anything but `fresh`, matching "effectively never" ageing out.
 */
export function ageBadge(
  oldestAcquiredOn: string,
  storageLocation: StorageLocation,
  now: Date = new Date()
): AgeBadge {
  const acquired = new Date(oldestAcquiredOn + "T00:00:00Z");
  const nowUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const ageDays = Math.max(
    0,
    Math.round((nowUtc.getTime() - acquired.getTime()) / (24 * 60 * 60 * 1000))
  );

  const threshold = AGE_THRESHOLD_DAYS[storageLocation];

  if (threshold === null) {
    return { ageDays, level: "fresh" };
  }

  if (ageDays >= threshold) {
    return { ageDays, level: "old" };
  }

  if (ageDays >= threshold / 2) {
    return { ageDays, level: "aging" };
  }

  return { ageDays, level: "fresh" };
}
