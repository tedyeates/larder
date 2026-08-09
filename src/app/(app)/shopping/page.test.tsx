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
            lastPurchasedAmount: null,
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
          },
        ],
      },
    ],
  },
];

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

  it("renders Shopping grouped into headed Aisle sections", async () => {
    render(<ShoppingPage />);

    expect(screen.getByRole("heading", { name: "Shopping" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("tab", { name: "Lidl" })).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "🥬 Fruit & Veg" })).toBeInTheDocument();
    expect(screen.getByText("Chicken thighs")).toBeInTheDocument();
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
    // The Shop's Aisles load after the list itself, so the option to select
    // only exists once that second read has landed.
    await waitFor(() => expect(within(aisleSelect).getByText(/Fruit & Veg/)).toBeInTheDocument());

    fireEvent.change(aisleSelect, { target: { value: "a1" } });
    fireEvent.click(within(item).getByRole("button", { name: "Assign aisle" }));

    await waitFor(() => {
      expect(addPlacement).toHaveBeenCalledWith({}, { ingredientId: "i2", aisleId: "a1" });
    });
  });

  it("buys immediately into a Stock Lot and can dismiss without stocking", async () => {
    render(<ShoppingPage />);
    await waitFor(() => expect(screen.getByText("Chicken thighs")).toBeInTheDocument());

    const chicken = screen.getByTestId("shopping-item-si1");
    fireEvent.change(within(chicken).getByLabelText("Purchased amount for Chicken thighs"), {
      target: { value: "6" },
    });
    fireEvent.click(within(chicken).getByRole("button", { name: "Buy Chicken thighs" }));

    await waitFor(() => {
      expect(buyShoppingItem).toHaveBeenCalledWith({}, "si1", {
        purchasedAmount: 6,
        storageLocation: "cupboard",
      });
    });

    fireEvent.click(within(screen.getByTestId("shopping-item-si2")).getByRole("button", { name: "Dismiss Kitchen towels" }));
    await waitFor(() => expect(dismissShoppingItem).toHaveBeenCalledWith({}, "si2"));
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
