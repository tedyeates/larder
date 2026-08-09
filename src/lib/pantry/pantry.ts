import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConsumeStockResult, PantrySummaryRow, StockLot, StorageLocation } from "./types";

/**
 * Data access for the Pantry (#5) — the deep module that owns every rule
 * about quantities and is the only thing that touches Stock Lots. All the
 * interesting logic (same-day merge, FIFO consumption, floor-at-zero,
 * Hand-Depleted exclusion) lives in the `add_stock_lot`, `consume_stock`
 * and `set_hand_depleted_fraction` RPCs and is exercised by pgTAP; this
 * module is thin wrappers plus the reads the Pantry screen needs, mirroring
 * src/lib/ingredients/registry.ts.
 *
 * Each function takes the Supabase client as a parameter rather than
 * constructing one, so callers can pass a browser client from a Client
 * Component and tests can pass a mock without reaching into module
 * internals.
 */

type Row = Record<string, unknown>;

function toStockLot(row: Row): StockLot {
  return {
    id: row.id as string,
    ingredientId: row.ingredient_id as string,
    quantity: Number(row.quantity),
    storageLocation: row.storage_location as StorageLocation,
    acquiredOn: row.acquired_on as string,
    createdAt: row.created_at as string,
  };
}

function toPantrySummaryRow(row: Row): PantrySummaryRow {
  return {
    ingredientId: row.ingredient_id as string,
    ingredientName: row.ingredient_name as string,
    stockUnit: row.stock_unit as string,
    isHandDepleted: row.is_hand_depleted as boolean,
    storageLocation: row.storage_location as StorageLocation,
    totalQuantity: Number(row.total_quantity),
    oldestAcquiredOn: row.oldest_acquired_on as string,
    lotCount: Number(row.lot_count),
  };
}

function toConsumeStockResult(row: Row): ConsumeStockResult {
  return {
    ingredientId: row.ingredient_id as string,
    requested: Number(row.requested),
    consumed: Number(row.consumed),
    shortfall: Number(row.shortfall),
  };
}

function errorMessage(error: { message: string } | null, fallback: string): string {
  return error?.message ?? fallback;
}

/** The Pantry screen's one grouped read: one row per Ingredient per Storage Location with stock. */
export async function listPantrySummary(client: SupabaseClient): Promise<PantrySummaryRow[]> {
  const { data, error } = await client
    .from("pantry_summary")
    .select("*")
    .order("storage_location", { ascending: true })
    .order("ingredient_name", { ascending: true });

  if (error) {
    throw new Error(errorMessage(error, "Failed to load the Pantry"));
  }

  return (data ?? []).map(toPantrySummaryRow);
}

/** The individual Lots behind one Ingredient's row, oldest first, for the expanded view. */
export async function listStockLots(
  client: SupabaseClient,
  ingredientId: string
): Promise<StockLot[]> {
  const { data, error } = await client
    .from("stock_lots")
    .select("*")
    .eq("ingredient_id", ingredientId)
    .order("acquired_on", { ascending: true });

  if (error) {
    throw new Error(errorMessage(error, "Failed to load Stock Lots"));
  }

  return (data ?? []).map(toStockLot);
}

/**
 * Adds stock for an Ingredient via the `add_stock_lot` RPC. Same
 * Ingredient+Storage Location+day merges into the existing Lot; anything
 * else creates a new one.
 */
export async function addStock(
  client: SupabaseClient,
  input: {
    ingredientId: string;
    quantity: number;
    storageLocation: StorageLocation;
    acquiredOn?: string;
  }
): Promise<StockLot> {
  const { data, error } = await client.rpc("add_stock_lot", {
    p_ingredient_id: input.ingredientId,
    p_quantity: input.quantity,
    p_storage_location: input.storageLocation,
    ...(input.acquiredOn ? { p_acquired_on: input.acquiredOn } : {}),
  });

  if (error) {
    throw new Error(errorMessage(error, "Failed to add stock"));
  }

  return toStockLot(data as Row);
}

/**
 * Consumes stock for an Auto-Depleted Ingredient oldest-first via the
 * `consume_stock` RPC. Never goes negative — reports what was actually
 * taken against what was requested rather than throwing on a shortfall.
 * Throws if the Ingredient is Hand-Depleted; use `setHandDepletedFraction`
 * for those instead.
 */
export async function consumeStock(
  client: SupabaseClient,
  ingredientId: string,
  quantity: number
): Promise<ConsumeStockResult> {
  const { data, error } = await client.rpc("consume_stock", {
    p_ingredient_id: ingredientId,
    p_quantity: quantity,
  });

  if (error) {
    throw new Error(errorMessage(error, "Failed to consume stock"));
  }

  return toConsumeStockResult(data as Row);
}

/**
 * Sets (not adds to) a Hand-Depleted Ingredient's quantity for one
 * Storage Location and day via `set_hand_depleted_fraction` — "eyeball
 * the soy sauce at half empty and set 0.5". A quantity of 0 removes the
 * Lot. Never touched by automatic depletion.
 */
export async function setHandDepletedFraction(
  client: SupabaseClient,
  input: {
    ingredientId: string;
    quantity: number;
    storageLocation: StorageLocation;
    acquiredOn?: string;
  }
): Promise<StockLot | null> {
  const { data, error } = await client.rpc("set_hand_depleted_fraction", {
    p_ingredient_id: input.ingredientId,
    p_quantity: input.quantity,
    p_storage_location: input.storageLocation,
    ...(input.acquiredOn ? { p_acquired_on: input.acquiredOn } : {}),
  });

  if (error) {
    throw new Error(errorMessage(error, "Failed to update Hand-Depleted quantity"));
  }

  return data ? toStockLot(data as Row) : null;
}

/** Edits a Stock Lot's quantity, Storage Location or date directly by hand, to correct drift. */
export async function updateStockLot(
  client: SupabaseClient,
  id: string,
  input: { quantity?: number; storageLocation?: StorageLocation; acquiredOn?: string }
): Promise<StockLot> {
  const patch: Row = {};
  if (input.quantity !== undefined) patch.quantity = input.quantity;
  if (input.storageLocation !== undefined) patch.storage_location = input.storageLocation;
  if (input.acquiredOn !== undefined) patch.acquired_on = input.acquiredOn;

  const { data, error } = await client
    .from("stock_lots")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(errorMessage(error, "Failed to update Stock Lot"));
  }

  return toStockLot(data);
}

/** Deletes a Stock Lot directly by hand. */
export async function deleteStockLot(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from("stock_lots").delete().eq("id", id);

  if (error) {
    throw new Error(errorMessage(error, "Failed to delete Stock Lot"));
  }
}
