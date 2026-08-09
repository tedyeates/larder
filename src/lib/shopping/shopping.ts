import type { SupabaseClient } from "@supabase/supabase-js";
import type { BuyShoppingItemInput, ShoppingShop } from "./types";

type Row = Record<string, unknown>;

type ShoppingListRow = Row & {
  shop_id: string;
  shop_name: string;
  shop_position: number | string;
  section_id: string | null;
  section_name: string | null;
  section_emoji: string | null;
  section_position: number | string | null;
  is_unsorted: boolean | null;
  shopping_item_id: string | null;
  ingredient_id: string | null;
  ingredient_name: string | null;
  stock_unit: string | null;
  required_amount: number | string | null;
  last_purchased_amount: number | string | null;
};

function errorMessage(error: { message: string } | null, fallback: string): string {
  return error?.message ?? fallback;
}

/**
 * Reads the one Shopping List projected into Shop tabs and Aisle-headed
 * sections. Grouping here makes the phone screen a thin renderer while the
 * database view owns which Shops each Item appears in.
 */
export async function listShoppingList(client: SupabaseClient): Promise<ShoppingShop[]> {
  const { data, error } = await client
    .from("shopping_list_by_shop")
    .select("*")
    .order("shop_position", { ascending: true })
    .order("is_unsorted", { ascending: true })
    .order("section_position", { ascending: true })
    .order("ingredient_name", { ascending: true });

  if (error) {
    throw new Error(errorMessage(error, "Failed to load Shopping List"));
  }

  const shops = new Map<string, ShoppingShop>();
  const sections = new Map<string, ShoppingShop["sections"][number]>();

  for (const row of (data ?? []) as ShoppingListRow[]) {
    let shop = shops.get(row.shop_id);
    if (!shop) {
      shop = {
        id: row.shop_id,
        name: row.shop_name,
        position: Number(row.shop_position),
        sections: [],
      };
      shops.set(shop.id, shop);
    }

    // A left join emits one null item row for a Shop with no current lines;
    // keep that Shop but do not manufacture an empty Unsorted section.
    if (row.shopping_item_id === null) continue;

    const sectionKey = `${row.shop_id}:${row.section_id ?? "unsorted"}`;
    let section = sections.get(sectionKey);
    if (!section) {
      section = {
        id: row.section_id ?? "unsorted",
        name: row.section_name ?? "Unsorted",
        emoji: row.section_emoji,
        position: Number(row.section_position),
        isUnsorted: row.is_unsorted ?? true,
        items: [],
      };
      sections.set(sectionKey, section);
      shop.sections.push(section);
    }

    section.items.push({
      id: row.shopping_item_id,
      ingredientId: row.ingredient_id!,
      ingredientName: row.ingredient_name!,
      stockUnit: row.stock_unit!,
      requiredAmount: Number(row.required_amount),
      lastPurchasedAmount:
        row.last_purchased_amount === null ? null : Number(row.last_purchased_amount),
    });
  }

  return [...shops.values()];
}

/** Adds an Item by hand, merging its Required Amount with any existing line. */
export async function addShoppingItem(
  client: SupabaseClient,
  ingredientId: string,
  requiredAmount: number
): Promise<void> {
  const { error } = await client.rpc("add_shopping_item", {
    p_ingredient_id: ingredientId,
    p_required_amount: requiredAmount,
  });

  if (error) {
    throw new Error(errorMessage(error, "Failed to add Shopping Item"));
  }
}

/**
 * Buys a shared list line via the atomic database transition. It both stocks
 * immediately and deletes the line, so every Shop tab loses it together.
 */
export async function buyShoppingItem(
  client: SupabaseClient,
  shoppingItemId: string,
  input: BuyShoppingItemInput
): Promise<void> {
  const { error } = await client.rpc("buy_shopping_item", {
    p_shopping_item_id: shoppingItemId,
    p_purchased_amount: input.purchasedAmount,
    p_storage_location: input.storageLocation,
  });

  if (error) {
    throw new Error(errorMessage(error, "Failed to buy Shopping Item"));
  }
}

/** Dismisses a line without changing Pantry stock. */
export async function dismissShoppingItem(
  client: SupabaseClient,
  shoppingItemId: string
): Promise<void> {
  const { error } = await client.rpc("dismiss_shopping_item", {
    p_shopping_item_id: shoppingItemId,
  });

  if (error) {
    throw new Error(errorMessage(error, "Failed to dismiss Shopping Item"));
  }
}
