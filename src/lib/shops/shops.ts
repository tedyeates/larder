import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Aisle,
  AisleWithPlacementCount,
  Placement,
  PlacementWithLocation,
  Shop,
} from "./types";

/**
 * Data access for Shops, Aisles and Placements (#6) — a Shop is a filter
 * over the Shopping List, not a destination, so nothing here ever decides
 * which Shop an Ingredient "belongs" to. All the interesting logic
 * (append-at-end positions, atomic full-set reordering, upsert-not-move
 * Placements) lives in the `create_shop`/`create_aisle`,
 * `reorder_shops`/`reorder_aisles` and `set_placement`/`remove_placement`
 * RPCs and is exercised by pgTAP; this module is thin wrappers, mirroring
 * src/lib/ingredients/registry.ts and src/lib/pantry/pantry.ts.
 *
 * Each function takes the Supabase client as a parameter rather than
 * constructing one, so callers can pass a browser client from a Client
 * Component and tests can pass a mock without reaching into module
 * internals.
 */

type Row = Record<string, unknown>;

function toShop(row: Row): Shop {
  return {
    id: row.id as string,
    name: row.name as string,
    position: Number(row.position),
    createdAt: row.created_at as string,
  };
}

function toAisle(row: Row): Aisle {
  return {
    id: row.id as string,
    shopId: row.shop_id as string,
    name: row.name as string,
    emoji: row.emoji as string,
    position: Number(row.position),
    createdAt: row.created_at as string,
  };
}

function toAisleWithPlacementCount(row: Row): AisleWithPlacementCount {
  return {
    id: row.aisle_id as string,
    shopId: row.shop_id as string,
    name: row.name as string,
    emoji: row.emoji as string,
    position: Number(row.position),
    createdAt: "",
    placementCount: Number(row.placement_count),
  };
}

function toPlacement(row: Row): Placement {
  return {
    id: row.id as string,
    ingredientId: row.ingredient_id as string,
    aisleId: row.aisle_id as string,
    createdAt: row.created_at as string,
  };
}

type PlacementJoinRow = Row & {
  aisles: {
    name: string;
    emoji: string;
    shop_id: string;
    shops: { name: string } | null;
  } | null;
};

function toPlacementWithLocation(row: PlacementJoinRow): PlacementWithLocation {
  const aisle = row.aisles;
  return {
    id: row.id as string,
    ingredientId: row.ingredient_id as string,
    aisleId: row.aisle_id as string,
    createdAt: row.created_at as string,
    aisleName: aisle?.name ?? "",
    aisleEmoji: aisle?.emoji ?? "",
    shopId: aisle?.shop_id ?? "",
    shopName: aisle?.shops?.name ?? "",
  };
}

function errorMessage(error: { message: string } | null, fallback: string): string {
  return error?.message ?? fallback;
}

// --- Shops -----------------------------------------------------------

export async function listShops(client: SupabaseClient): Promise<Shop[]> {
  const { data, error } = await client
    .from("shops")
    .select("*")
    .order("position", { ascending: true });

  if (error) {
    throw new Error(errorMessage(error, "Failed to load Shops"));
  }

  return (data ?? []).map(toShop);
}

/** Creates a Shop appended at the end of the current display order. */
export async function createShop(client: SupabaseClient, name: string): Promise<Shop> {
  const { data, error } = await client.rpc("create_shop", { p_name: name });

  if (error) {
    throw new Error(errorMessage(error, "Failed to create Shop"));
  }

  return toShop(data as Row);
}

export async function renameShop(client: SupabaseClient, id: string, name: string): Promise<Shop> {
  const { data, error } = await client
    .from("shops")
    .update({ name })
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(errorMessage(error, "Failed to rename Shop"));
  }

  return toShop(data);
}

/** Reassigns display order 0..n-1 by the order of `shopIds`, which must list every Shop exactly once. */
export async function reorderShops(client: SupabaseClient, shopIds: string[]): Promise<void> {
  const { error } = await client.rpc("reorder_shops", { p_shop_ids: shopIds });

  if (error) {
    throw new Error(errorMessage(error, "Failed to reorder Shops"));
  }
}

export async function deleteShop(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from("shops").delete().eq("id", id);

  if (error) {
    throw new Error(errorMessage(error, "Failed to delete Shop"));
  }
}

// --- Aisles ------------------------------------------------------------

/** One Shop's Aisles in display order, each with its Placement count. */
export async function listAisles(
  client: SupabaseClient,
  shopId: string
): Promise<AisleWithPlacementCount[]> {
  const { data, error } = await client
    .from("shop_aisles")
    .select("*")
    .eq("shop_id", shopId)
    .order("position", { ascending: true });

  if (error) {
    throw new Error(errorMessage(error, "Failed to load Aisles"));
  }

  return (data ?? []).map(toAisleWithPlacementCount);
}

/** Creates an Aisle appended at the end of its Shop's current display order. */
export async function createAisle(
  client: SupabaseClient,
  input: { shopId: string; name: string; emoji: string }
): Promise<Aisle> {
  const { data, error } = await client.rpc("create_aisle", {
    p_shop_id: input.shopId,
    p_name: input.name,
    p_emoji: input.emoji,
  });

  if (error) {
    throw new Error(errorMessage(error, "Failed to create Aisle"));
  }

  return toAisle(data as Row);
}

export async function updateAisle(
  client: SupabaseClient,
  id: string,
  input: { name?: string; emoji?: string }
): Promise<Aisle> {
  const patch: Row = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.emoji !== undefined) patch.emoji = input.emoji;

  const { data, error } = await client
    .from("aisles")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(errorMessage(error, "Failed to update Aisle"));
  }

  return toAisle(data);
}

/** Reassigns display order 0..n-1 within one Shop by the order of `aisleIds`, which must list every one of its Aisles exactly once. */
export async function reorderAisles(
  client: SupabaseClient,
  shopId: string,
  aisleIds: string[]
): Promise<void> {
  const { error } = await client.rpc("reorder_aisles", {
    p_shop_id: shopId,
    p_aisle_ids: aisleIds,
  });

  if (error) {
    throw new Error(errorMessage(error, "Failed to reorder Aisles"));
  }
}

export async function deleteAisle(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from("aisles").delete().eq("id", id);

  if (error) {
    throw new Error(errorMessage(error, "Failed to delete Aisle"));
  }
}

// --- Placements ----------------------------------------------------------

/** Every Placement for one Ingredient, across every Shop it appears in. */
export async function listPlacementsForIngredient(
  client: SupabaseClient,
  ingredientId: string
): Promise<PlacementWithLocation[]> {
  const { data, error } = await client
    .from("placements")
    .select("*, aisles(name, emoji, shop_id, shops(name))")
    .eq("ingredient_id", ingredientId);

  if (error) {
    throw new Error(errorMessage(error, "Failed to load Placements"));
  }

  return (data ?? []).map((row) => toPlacementWithLocation(row as PlacementJoinRow));
}

/** Every Placement in one Aisle, i.e. the Ingredients shown under it in that Shop. */
export async function listPlacementsForAisle(
  client: SupabaseClient,
  aisleId: string
): Promise<Placement[]> {
  const { data, error } = await client
    .from("placements")
    .select("*")
    .eq("aisle_id", aisleId);

  if (error) {
    throw new Error(errorMessage(error, "Failed to load Placements"));
  }

  return (data ?? []).map(toPlacement);
}

/**
 * Attaches an Ingredient to an Aisle in a Shop via the `set_placement`
 * RPC. Idempotent for an Ingredient already placed in that exact Aisle,
 * and never touches any Placement the Ingredient holds elsewhere — the
 * same Ingredient can sit in several Shops at once.
 */
export async function addPlacement(
  client: SupabaseClient,
  input: { ingredientId: string; aisleId: string }
): Promise<Placement> {
  const { data, error } = await client.rpc("set_placement", {
    p_ingredient_id: input.ingredientId,
    p_aisle_id: input.aisleId,
  });

  if (error) {
    throw new Error(errorMessage(error, "Failed to add Placement"));
  }

  return toPlacement(data as Row);
}

/** Removes one Ingredient's Placement in one Aisle, leaving its Placements elsewhere untouched. */
export async function removePlacement(
  client: SupabaseClient,
  input: { ingredientId: string; aisleId: string }
): Promise<void> {
  const { error } = await client.rpc("remove_placement", {
    p_ingredient_id: input.ingredientId,
    p_aisle_id: input.aisleId,
  });

  if (error) {
    throw new Error(errorMessage(error, "Failed to remove Placement"));
  }
}
