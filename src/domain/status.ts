/**
 * Pantry status.
 *
 * Flags are independent — a row can be both "use soon" and "low". The table
 * shows at most two chips and sorts by severity: Out, Use soon, Low, OK.
 *
 * "Low" is plan-aware with an optional floor: it fires when the rest of this
 * week's planned recipe meals need more than is on hand, or when the balance is
 * at or below a minimum you set. Without an active plan only the minimum can
 * raise it.
 */

import { daysBetween } from "./dates";
import { balance, earliestBestBefore, type StockEntry } from "./ledger";
import { roundAmount } from "./units";

export interface PantryStatus {
  readonly onHand: number;
  readonly out: boolean;
  readonly low: boolean;
  readonly useSoon: boolean;
  readonly expired: boolean;
  readonly earliestBestBefore: string | null;
  readonly daysUntilExpiry: number | null;
}

export interface PantryStatusInput {
  readonly entries: readonly StockEntry[];
  readonly today: string;
  /** User-set floor, in base units. */
  readonly minStock?: number | null;
  /** What the rest of this week's planned recipe meals still need, in base units. */
  readonly weekRequirement?: number;
  readonly soonWithinDays?: number;
}

export function pantryStatus(input: PantryStatusInput): PantryStatus {
  const soonWithinDays = input.soonWithinDays ?? 3;
  const onHand = balance(input.entries);
  const out = onHand <= 0;

  const earliest = earliestBestBefore(input.entries);
  const daysUntilExpiry = earliest === null ? null : daysBetween(input.today, earliest);

  const expired = !out && daysUntilExpiry !== null && daysUntilExpiry < 0;
  const useSoon =
    !out && daysUntilExpiry !== null && daysUntilExpiry >= 0 && daysUntilExpiry <= soonWithinDays;

  const byMinimum = input.minStock != null && onHand <= input.minStock;
  const byPlan =
    input.weekRequirement != null && roundAmount(input.weekRequirement) > roundAmount(onHand);

  return {
    onHand,
    out,
    low: byMinimum || byPlan,
    useSoon,
    expired,
    earliestBestBefore: earliest,
    daysUntilExpiry,
  };
}

/** Severity order for the pantry table, worst first. */
export function statusRank(status: PantryStatus): number {
  if (status.out) return 0;
  if (status.useSoon || status.expired) return 1;
  if (status.low) return 2;
  return 3;
}

export function statusLabel(status: PantryStatus): "Out" | "Use soon" | "Low" | "OK" {
  if (status.out) return "Out";
  if (status.expired) return "Use soon";
  if (status.useSoon) return "Use soon";
  if (status.low) return "Low";
  return "OK";
}
