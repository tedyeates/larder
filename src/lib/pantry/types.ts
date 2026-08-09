/**
 * Domain types for the Pantry (#5). Mirrors the shape of
 * `public.stock_lots` and the `public.pantry_summary` view — see
 * supabase/migrations/20260104000000_pantry.sql.
 */

export type StorageLocation =
  | "fridge"
  | "freezer"
  | "cupboard"
  | "counter"
  | "household"
  | "medicine";

export const STORAGE_LOCATIONS: StorageLocation[] = [
  "fridge",
  "freezer",
  "cupboard",
  "counter",
  "household",
  "medicine",
];

export const STORAGE_LOCATION_LABELS: Record<StorageLocation, string> = {
  fridge: "Fridge",
  freezer: "Freezer",
  cupboard: "Cupboard",
  counter: "Counter",
  household: "Household",
  medicine: "Medicine",
};

/** A Stock Lot: a quantity of one Ingredient acquired on one date, in one Storage Location. */
export type StockLot = {
  id: string;
  ingredientId: string;
  quantity: number;
  storageLocation: StorageLocation;
  acquiredOn: string;
  createdAt: string;
};

/**
 * One row per Ingredient per Storage Location with stock — the shape the
 * Pantry screen groups and lists. `oldestAcquiredOn` backs the age badge.
 */
export type PantrySummaryRow = {
  ingredientId: string;
  ingredientName: string;
  stockUnit: string;
  isHandDepleted: boolean;
  storageLocation: StorageLocation;
  totalQuantity: number;
  oldestAcquiredOn: string;
  lotCount: number;
};

/** Result of `consume_stock`: what was asked for versus what actually existed. */
export type ConsumeStockResult = {
  ingredientId: string;
  requested: number;
  consumed: number;
  shortfall: number;
};
