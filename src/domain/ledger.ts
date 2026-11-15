/**
 * The stock ledger.
 *
 * Quantities are append-only. A balance is always a sum, never a stored field.
 * Positive entries are lots (shopping, manual additions); negative entries are
 * consumption (cooking, using up, discarding). Consumption always eats the
 * oldest lot first, so a pantry row can honestly say what's about to turn.
 */

import { compareIsoDates, daysBetween } from "./dates";
import { roundAmount } from "./units";

export type StockReason = "purchase" | "cook" | "adjust" | "discard";

export interface StockEntry {
  readonly id: string;
  readonly ingredientId: string;
  /** Signed, in the ingredient's base unit (g, ml, or the count unit). */
  readonly quantity: number;
  /** ISO date the stock entered the pantry. */
  readonly acquiredAt: string;
  readonly bestBefore?: string | null;
  readonly reason: StockReason;
}

export interface RemainingLot {
  readonly entryId: string;
  readonly quantity: number;
  readonly acquiredAt: string;
  readonly bestBefore: string | null;
}

export interface Consumption {
  readonly entryId: string;
  readonly amount: number;
}

export interface Deduction {
  /** One negative entry per lot consumed, oldest first. */
  readonly consumptions: readonly Consumption[];
  readonly deducted: number;
  readonly shortfall: number;
  /** What was on hand before the deduction. */
  readonly available: number;
}

export function balance(entries: readonly StockEntry[]): number {
  return roundAmount(entries.reduce((total, entry) => total + entry.quantity, 0));
}

function compareLots(a: RemainingLot, b: RemainingLot): number {
  const byAcquired = compareIsoDates(a.acquiredAt, b.acquiredAt);
  if (byAcquired !== 0) return byAcquired;

  // No best-before means it keeps; dated lots go first.
  if (a.bestBefore !== b.bestBefore) {
    if (a.bestBefore === null) return 1;
    if (b.bestBefore === null) return -1;
    return compareIsoDates(a.bestBefore, b.bestBefore);
  }
  return a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0;
}

/**
 * The lots still holding stock after replaying every deduction oldest-first.
 * This is the single source of truth for "what's in the pantry, and how old".
 */
export function remainingLots(entries: readonly StockEntry[]): RemainingLot[] {
  const lots = entries
    .filter((entry) => entry.quantity > 0)
    .map<RemainingLot>((entry) => ({
      entryId: entry.id,
      quantity: entry.quantity,
      acquiredAt: entry.acquiredAt,
      bestBefore: entry.bestBefore ?? null,
    }))
    .sort(compareLots);

  const consumed = roundAmount(
    entries.reduce((total, entry) => (entry.quantity < 0 ? total - entry.quantity : total), 0),
  );

  let stillToConsume = consumed;
  const remaining: RemainingLot[] = [];

  for (const lot of lots) {
    if (stillToConsume <= 0) {
      remaining.push(lot);
      continue;
    }
    const used = Math.min(lot.quantity, stillToConsume);
    stillToConsume = roundAmount(stillToConsume - used);
    const left = roundAmount(lot.quantity - used);
    if (left > 0) remaining.push({ ...lot, quantity: left });
  }

  return remaining;
}

/** Earliest best-before among lots that still hold stock, or null. */
export function earliestBestBefore(entries: readonly StockEntry[]): string | null {
  let earliest: string | null = null;
  for (const lot of remainingLots(entries)) {
    if (lot.bestBefore === null) continue;
    if (earliest === null || compareIsoDates(lot.bestBefore, earliest) < 0)
      earliest = lot.bestBefore;
  }
  return earliest;
}

export type ExpiryState = "none" | "expired" | "soon" | "ok";

export function expiryState(
  bestBefore: string | null,
  today: string,
  soonWithinDays = 3,
): ExpiryState {
  if (bestBefore === null) return "none";
  const days = daysBetween(today, bestBefore);
  if (days < 0) return "expired";
  if (days <= soonWithinDays) return "soon";
  return "ok";
}

/**
 * Work out which lots a cook (or any consumption) should draw from.
 * Never returns more than is available: the remainder is the shortfall.
 */
export function planDeduction(entries: readonly StockEntry[], required: number): Deduction {
  const lots = remainingLots(entries);
  const available = roundAmount(lots.reduce((total, lot) => total + lot.quantity, 0));

  if (required <= 0) {
    return { consumptions: [], deducted: 0, shortfall: 0, available };
  }

  let need = roundAmount(required);
  const consumptions: Consumption[] = [];

  for (const lot of lots) {
    if (need <= 0) break;
    const take = roundAmount(Math.min(lot.quantity, need));
    if (take <= 0) continue;
    consumptions.push({ entryId: lot.entryId, amount: take });
    need = roundAmount(need - take);
  }

  return {
    consumptions,
    deducted: roundAmount(required - need),
    shortfall: need,
    available,
  };
}

/** Total consumed from this ingredient, ignoring signs. Useful for reports later. */
export function totalConsumed(entries: readonly StockEntry[]): number {
  return roundAmount(
    entries.reduce((total, entry) => (entry.quantity < 0 ? total - entry.quantity : total), 0),
  );
}
