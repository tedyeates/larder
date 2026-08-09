import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import ShoppingPage from "./page";
import type { Ingredient } from "@/lib/ingredients/types";
import type { ShoppingShop } from "@/lib/shopping/types";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

const listShoppingList = vi.fn();
const addShoppingItem = vi.fn();
const buyShoppingItem = vi.fn();
const dismissShoppingItem = vi.fn();
vi.mock("@/lib/shopping/shopping", () => ({
  listShoppingList: (...args: unknown[]) => listShoppingList(...args),
  addShoppingItem: (...args: unknown[]) => addShoppingItem(...args),
  buyShoppingItem: (...args: unknown[]) => buyShoppingItem(...args),
  dismissShoppingItem: (...args: unknown[]) => dismissShoppingItem(...args),
}));

const listIngredients = vi.fn();
vi.mock("@/lib/ingredients/registry", () => ({
  listIngredients: (...args: unknown[]) => listIngredients(...args),
}));

const listAisles = vi.fn();
const addPlacement = vi.fn();
vi.mock("@/lib/shops/shops", () => ({
  listAisles: (...args: unknown[]) => listAisles(...args),
  addPlacement: (...args: unknown[]) => addPlacement(...args),
}));

const ingredients: Ingredient[] = [
  {
    id: "i1",
    name: "Chicken thighs",
    stockUnit: "pieces",
    isHandDepleted: false,
    lastPurchasedAmount: null,
    status: "active",
    createdAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "i2",
    name: "Kitchen towels",
    stockUnit: "rolls",
    isHandDepleted: false,
    lastPurchasedAmount: null,
    status: "active",
    createdAt: "2026-01-01T00:00:00Z",
  },
];

const shops: ShoppingShop[] = [
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
            ingredientName: "Chicken thighs",
            stockUnit: "pieces",
            requiredAmount: 4,
            lastPurchasedAmount: 6,
            substitutes: [
              {
                ingredientId: "i3",
                ingredientName: "Chicken breast",
                stockUnit: "pieces",
                lastPurchasedAmount: 10,
              },
            ],
          },
        ],
      },
      {
        id: "unsorted",
        name: "Unsorted",
        emoji: null,
        position: Number.MAX_SAFE_INTEGER,
        isUnsorted: true,
        items: [
          {
            id: "si2",
            ingredientId: "i2",
            ingredientName: "Kitchen towels",
            stockUnit: "rolls",
            requiredAmount: 2,
            lastPurchasedAmount: null,
            substitutes: [],
          },
        ],
      },
    ],
  },
  {
    id: "s2",
    name: "Asian Supermarket",
    position: 1,
    sections: [
      {
        id: "unsorted",
        name: "Unsorted",
        emoji: null,
        position: Number.MAX_SAFE_INTEGER,
        isUnsorted: true,
        items: [
          {
            id: "si2",
            ingredientId: "i2",
            ingredientName: "Kitchen towels",
            stockUnit: "rolls",
            requiredAmount: 2,
            lastPurchasedAmount: null,
            substitutes: [],
          },
        ],
      },
    ],
  },
];

function swipe(element: Element, from: { x: number; y: number }, to: { x: number; y: number }) {
  fireEvent(element, new MouseEvent("pointerdown", { bubbles: true, clientX: from.x, clientY: from.y }));
  fireEvent(element, new MouseEvent("pointerup", { bubbles: true, clientX: to.x, clientY: to.y }));
}

describe("ShoppingPage", () => {
  beforeEach(() => {
    listShoppingList.mockReset().mockResolvedValue(shops);
    listIngredients.mockReset().mockResolvedValue(ingredients);
    listAisles.mockReset().mockResolvedValue([
      { id: "a1", shopId: "s1", name: "Fruit & Veg", emoji: "🥬", position: 0, createdAt: "", placementCount: 1 },
    ]);
    addShoppingItem.mockReset().mockResolvedValue({});
    buyShoppingItem.mockReset().mockResolvedValue({});
    dismissShoppingItem.mockReset().mockResolvedValue(undefined);
    addPlacement.mockReset().mockResolvedValue({});
  });

  async function renderLoadedPage() {
    render(<ShoppingPage />);
    await waitFor(() => expect(screen.getByText("Chicken thighs")).toBeInTheDocument());
    return screen.getByTestId("shopping-item-si1");
  }

  it("renders Shopping grouped into headed Aisle sections with distinguishable Required and Suggested amounts", async () => {
    await renderLoadedPage();

    expect(screen.getByRole("heading", { name: "Shopping" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Lidl" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "🥬 Fruit & Veg" })).toBeInTheDocument();
    expect(screen.getByText("Required: 4 pieces")).toBeInTheDocument();
    expect(screen.getByText("Suggested: 6 pieces")).toBeInTheDocument();
    expect(screen.getByText("Suggested: 2 rolls")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Unsorted" })).toBeInTheDocument();
    expect(screen.getByText("Kitchen towels")).toBeInTheDocument();
  });

  it("switches Shop tabs while keeping globally Unsorted items buyable", async () => {
    render(<ShoppingPage />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "Asian Supermarket" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("tab", { name: "Asian Supermarket" }));

    expect(screen.getByRole("tabpanel", { name: "Asian Supermarket" })).toBeInTheDocument();
    expect(within(screen.getByRole("tabpanel", { name: "Asian Supermarket" })).getByText("Kitchen towels")).toBeInTheDocument();
    expect(screen.queryByText("Chicken thighs")).not.toBeInTheDocument();
  });

  it("adds any registered Ingredient, including a non-food item, by hand", async () => {
    render(<ShoppingPage />);
    await waitFor(() => expect(screen.getByLabelText("Shopping item")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Shopping item"), { target: { value: "i2" } });
    fireEvent.change(screen.getByLabelText("Required amount"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));

    await waitFor(() => expect(addShoppingItem).toHaveBeenCalledWith({}, "i2", 3));
  });

  it("assigns an Aisle from Unsorted", async () => {
    render(<ShoppingPage />);
    await waitFor(() => expect(screen.getByText("Kitchen towels")).toBeInTheDocument());

    const item = screen.getByTestId("shopping-item-si2");
    const aisleSelect = within(item).getByLabelText("Aisle for Kitchen towels");
    await waitFor(() => expect(within(aisleSelect).getByText(/Fruit & Veg/)).toBeInTheDocument());

    fireEvent.change(aisleSelect, { target: { value: "a1" } });
    fireEvent.click(within(item).getByRole("button", { name: "Assign aisle" }));

    await waitFor(() => {
      expect(addPlacement).toHaveBeenCalledWith({}, { ingredientId: "i2", aisleId: "a1" });
    });
  });

  it("banks Suggested Amount on tap", async () => {
    const chicken = await renderLoadedPage();

    fireEvent.click(within(chicken).getByText("Chicken thighs"));

    await waitFor(() => {
      expect(buyShoppingItem).toHaveBeenCalledWith({}, "si1", {
        purchasedAmount: 6,
        storageLocation: "cupboard",
        ingredientId: "i1",
      });
    });
  });

  it("banks Suggested Amount on swipe-right", async () => {
    const chicken = await renderLoadedPage();

    swipe(chicken, { x: 10, y: 20 }, { x: 100, y: 20 });

    await waitFor(() => expect(buyShoppingItem).toHaveBeenCalledTimes(1));
    expect(buyShoppingItem).toHaveBeenLastCalledWith({}, "si1", {
      purchasedAmount: 6,
      storageLocation: "cupboard",
      ingredientId: "i1",
    });
  });

  it("swipe-left reveals buy Required Amount action", async () => {
    const chicken = await renderLoadedPage();

    swipe(chicken, { x: 100, y: 20 }, { x: 10, y: 20 });
    fireEvent.click(await within(chicken).findByRole("button", { name: "Buy required amount" }));

    await waitFor(() => expect(buyShoppingItem).toHaveBeenCalledWith({}, "si1", {
      purchasedAmount: 4,
      storageLocation: "cupboard",
      ingredientId: "i1",
    }));
  });

  it("swipe-left reveals custom purchase action", async () => {
    const chicken = await renderLoadedPage();

    swipe(chicken, { x: 100, y: 20 }, { x: 10, y: 20 });
    fireEvent.click(await within(chicken).findByRole("button", { name: "Buy custom amount" }));
    fireEvent.change(within(chicken).getByLabelText("Custom amount for Chicken thighs"), { target: { value: "8" } });
    fireEvent.click(within(chicken).getByRole("button", { name: "Confirm custom purchase" }));

    await waitFor(() => expect(buyShoppingItem).toHaveBeenCalledWith({}, "si1", {
      purchasedAmount: 8,
      storageLocation: "cupboard",
      ingredientId: "i1",
    }));
  });

  it("swipe-left reveals delete without stocking action", async () => {
    const chicken = await renderLoadedPage();

    swipe(chicken, { x: 100, y: 20 }, { x: 10, y: 20 });
    fireEvent.click(await within(chicken).findByRole("button", { name: "Delete without stocking" }));

    await waitFor(() => expect(dismissShoppingItem).toHaveBeenCalledWith({}, "si1"));
  });

  it("cycles substitutes with both vertical swipe directions and stocks selection", async () => {
    const chicken = await renderLoadedPage();

    swipe(chicken, { x: 50, y: 100 }, { x: 50, y: 10 });
    expect(within(chicken).getByText("Buying: Chicken breast")).toBeInTheDocument();
    expect(within(chicken).getByText("Suggested: 10 pieces")).toBeInTheDocument();

    swipe(chicken, { x: 50, y: 10 }, { x: 50, y: 100 });
    expect(within(chicken).getByText("Buying: Chicken thighs")).toBeInTheDocument();

    swipe(chicken, { x: 50, y: 100 }, { x: 50, y: 10 });
    fireEvent.click(within(chicken).getByRole("button", { name: "Buy suggested amount" }));
    await waitFor(() => expect(buyShoppingItem).toHaveBeenCalledWith({}, "si1", {
      purchasedAmount: 10,
      storageLocation: "cupboard",
      ingredientId: "i3",
    }));
  });

  it("keeps every gesture action reachable with desktop controls", async () => {
    const chicken = await renderLoadedPage();

    fireEvent.click(within(chicken).getByRole("button", { name: "Show shopping actions" }));
    expect(within(chicken).getByRole("button", { name: "Buy required amount" })).toBeInTheDocument();
    expect(within(chicken).getByRole("button", { name: "Buy custom amount" })).toBeInTheDocument();
    expect(within(chicken).getByRole("button", { name: "Delete without stocking" })).toBeInTheDocument();
    fireEvent.click(within(chicken).getByRole("button", { name: "Next substitute" }));
    expect(within(chicken).getByText("Buying: Chicken breast")).toBeInTheDocument();
  });

  it("shows empty and error states", async () => {
    listShoppingList.mockResolvedValueOnce([]);
    render(<ShoppingPage />);
    await waitFor(() => expect(screen.getByTestId("shopping-empty")).toBeInTheDocument());
  });

  it("shows load failures", async () => {
    listShoppingList.mockRejectedValueOnce(new Error("network down"));
    render(<ShoppingPage />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("network down"));
  });
});
