import { describe, expect, it, vi } from "vitest";
import {
  addShoppingItem,
  buyShoppingItem,
  dismissShoppingItem,
  listShoppingList,
} from "./shopping";

function makeFakeClient(result: { data?: unknown; error?: { message: string } | null }) {
  const terminal = { data: result.data ?? null, error: result.error ?? null };
  const builder: Record<string, unknown> = {
    then: (resolve: (value: typeof terminal) => void) => resolve(terminal),
  };
  builder.select = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);

  const from = vi.fn(() => builder);
  const rpc = vi.fn(() => Promise.resolve(terminal));

  return { from, rpc, __builder: builder } as unknown as import("@supabase/supabase-js").SupabaseClient & {
    __builder: Record<string, ReturnType<typeof vi.fn>>;
  };
}

describe("listShoppingList", () => {
  it("groups the database Shop/Aisle projection into headed sections", async () => {
    const client = makeFakeClient({
      data: [
        {
          shop_id: "s1",
          shop_name: "Lidl",
          shop_position: 0,
          section_id: "a1",
          section_name: "Fruit & Veg",
          section_emoji: "🥬",
          section_position: 0,
          is_unsorted: false,
          shopping_item_id: "si1",
          ingredient_id: "i1",
          ingredient_name: "Carrots",
          stock_unit: "pieces",
          required_amount: "4",
          last_purchased_amount: null,
        },
        {
          shop_id: "s1",
          shop_name: "Lidl",
          shop_position: 0,
          section_id: null,
          section_name: "Unsorted",
          section_emoji: null,
          section_position: 2147483647,
          is_unsorted: true,
          shopping_item_id: "si2",
          ingredient_id: "i2",
          ingredient_name: "Kitchen towels",
          stock_unit: "rolls",
          required_amount: "2",
          last_purchased_amount: "3",
        },
      ],
    });

    await expect(listShoppingList(client)).resolves.toEqual([
      {
        id: "s1",
        name: "Lidl",
        position: 0,
        sections: [
          {
            id: "a1",
            name: "Fruit & Veg",
            emoji: "🥬",
            position: 0,
            isUnsorted: false,
            items: [
              {
                id: "si1",
                ingredientId: "i1",
                ingredientName: "Carrots",
                stockUnit: "pieces",
                requiredAmount: 4,
                lastPurchasedAmount: null,
              },
            ],
          },
          {
            id: "unsorted",
            name: "Unsorted",
            emoji: null,
            position: 2147483647,
            isUnsorted: true,
            items: [
              {
                id: "si2",
                ingredientId: "i2",
                ingredientName: "Kitchen towels",
                stockUnit: "rolls",
                requiredAmount: 2,
                lastPurchasedAmount: 3,
              },
            ],
          },
        ],
      },
    ]);
    expect(client.from).toHaveBeenCalledWith("shopping_list_by_shop");
  });

  it("keeps a Shop with no current lines as an empty tab", async () => {
    const client = makeFakeClient({
      data: [
        {
          shop_id: "s2",
          shop_name: "Corner Shop",
          shop_position: 1,
          section_id: null,
          section_name: null,
          section_emoji: null,
          section_position: null,
          is_unsorted: null,
          shopping_item_id: null,
          ingredient_id: null,
          ingredient_name: null,
          stock_unit: null,
          required_amount: null,
          last_purchased_amount: null,
        },
      ],
    });

    await expect(listShoppingList(client)).resolves.toEqual([
      { id: "s2", name: "Corner Shop", position: 1, sections: [] },
    ]);
  });

  it("surfaces read failures", async () => {
    await expect(listShoppingList(makeFakeClient({ error: { message: "boom" } }))).rejects.toThrow("boom");
  });
});

describe("Shopping List transitions", () => {
  it("adds through the merge-on-add RPC", async () => {
    const client = makeFakeClient({});
    await addShoppingItem(client, "i1", 4);
    expect(client.rpc).toHaveBeenCalledWith("add_shopping_item", {
      p_ingredient_id: "i1",
      p_required_amount: 4,
    });
  });

  it("buys through the atomic stock-and-remove RPC", async () => {
    const client = makeFakeClient({});
    await buyShoppingItem(client, "si1", { purchasedAmount: 6, storageLocation: "cupboard" });
    expect(client.rpc).toHaveBeenCalledWith("buy_shopping_item", {
      p_shopping_item_id: "si1",
      p_purchased_amount: 6,
      p_storage_location: "cupboard",
    });
  });

  it("dismisses without issuing a Pantry write", async () => {
    const client = makeFakeClient({});
    await dismissShoppingItem(client, "si1");
    expect(client.rpc).toHaveBeenCalledWith("dismiss_shopping_item", { p_shopping_item_id: "si1" });
  });

  it("surfaces transition failures", async () => {
    await expect(addShoppingItem(makeFakeClient({ error: { message: "bad amount" } }), "i1", 0)).rejects.toThrow(
      "bad amount"
    );
  });
});
