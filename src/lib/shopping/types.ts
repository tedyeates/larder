import type { StorageLocation } from "@/lib/pantry/types";

/** An Ingredient approved as a substitute for at least one Recipe Line using this Shopping Item. */
export type ShoppingSubstitute = {
  ingredientId: string;
  ingredientName: string;
  stockUnit: string;
  lastPurchasedAmount: number | null;
};

/** One visible Shopping List line, joined to its Ingredient and acceptable Recipe substitutes. */
export type ShoppingItem = {
  id: string;
  ingredientId: string;
  ingredientName: string;
  stockUnit: string;
  requiredAmount: number;
  lastPurchasedAmount: number | null;
  substitutes: ShoppingSubstitute[];
};

/** One headed Aisle section in a Shop tab. `Unsorted` has no emoji or physical Aisle id. */
export type ShoppingSection = {
  id: string;
  name: string;
  emoji: string | null;
  position: number;
  isUnsorted: boolean;
  items: ShoppingItem[];
};

/** One Shop's complete Shopping List view, sectioned in walking order. */
export type ShoppingShop = {
  id: string;
  name: string;
  position: number;
  sections: ShoppingSection[];
};

export type BuyShoppingItemInput = {
  purchasedAmount: number;
  storageLocation: StorageLocation;
  /** Original Ingredient or a Recipe-approved Substitute chosen on the Shopping line. */
  ingredientId: string;
};
