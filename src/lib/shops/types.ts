/**
 * Domain types for Shops, Aisles and Placements (#6). Mirrors the shape of
 * `public.shops`, `public.aisles`, `public.placements` and the
 * `public.shop_aisles` view — see
 * supabase/migrations/20260105000000_shops_aisles_placements.sql.
 */

/** A place you buy from — a filter over the Shopping List, not a destination. */
export type Shop = {
  id: string;
  name: string;
  position: number;
  createdAt: string;
};

/** A named, emoji-carrying section of one Shop, ordered to match how you walk it. */
export type Aisle = {
  id: string;
  shopId: string;
  name: string;
  emoji: string;
  position: number;
  createdAt: string;
};

/** One row from `shop_aisles`: an Aisle plus how many Placements it holds. */
export type AisleWithPlacementCount = Aisle & {
  placementCount: number;
};

/** The Aisle an Ingredient sits in at a given Shop. */
export type Placement = {
  id: string;
  ingredientId: string;
  aisleId: string;
  createdAt: string;
};

/** A Placement joined with enough Aisle/Shop context to render without extra lookups. */
export type PlacementWithLocation = Placement & {
  aisleName: string;
  aisleEmoji: string;
  shopId: string;
  shopName: string;
};
