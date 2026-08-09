import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import ShopsPage from "./page";
import type { AisleWithPlacementCount, Shop } from "@/lib/shops/types";
import type { Ingredient } from "@/lib/ingredients/types";

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

const listShops = vi.fn();
const createShop = vi.fn();
const renameShop = vi.fn();
const deleteShop = vi.fn();
const reorderShops = vi.fn();
const listAisles = vi.fn();
const createAisle = vi.fn();
const updateAisle = vi.fn();
const deleteAisle = vi.fn();
const reorderAisles = vi.fn();
const listPlacementsForAisle = vi.fn();
const addPlacement = vi.fn();
const removePlacement = vi.fn();

vi.mock("@/lib/shops/shops", () => ({
  listShops: (...args: unknown[]) => listShops(...args),
  createShop: (...args: unknown[]) => createShop(...args),
  renameShop: (...args: unknown[]) => renameShop(...args),
  deleteShop: (...args: unknown[]) => deleteShop(...args),
  reorderShops: (...args: unknown[]) => reorderShops(...args),
  listAisles: (...args: unknown[]) => listAisles(...args),
  createAisle: (...args: unknown[]) => createAisle(...args),
  updateAisle: (...args: unknown[]) => updateAisle(...args),
  deleteAisle: (...args: unknown[]) => deleteAisle(...args),
  reorderAisles: (...args: unknown[]) => reorderAisles(...args),
  listPlacementsForAisle: (...args: unknown[]) => listPlacementsForAisle(...args),
  addPlacement: (...args: unknown[]) => addPlacement(...args),
  removePlacement: (...args: unknown[]) => removePlacement(...args),
}));

const listIngredients = vi.fn();

vi.mock("@/lib/ingredients/registry", () => ({
  listIngredients: (...args: unknown[]) => listIngredients(...args),
}));

const lidl: Shop = { id: "s1", name: "Lidl", position: 0, createdAt: "2026-01-01T00:00:00Z" };
const asianSupermarket: Shop = {
  id: "s2",
  name: "Asian Supermarket",
  position: 1,
  createdAt: "2026-01-01T00:00:00Z",
};

const dryGoods: AisleWithPlacementCount = {
  id: "a1",
  shopId: "s1",
  name: "Dry Goods",
  emoji: "🍚",
  position: 0,
  createdAt: "",
  placementCount: 1,
};

const fruitVeg: AisleWithPlacementCount = {
  id: "a2",
  shopId: "s1",
  name: "🥬 Fruit & Veg",
  emoji: "🥬",
  position: 1,
  createdAt: "",
  placementCount: 0,
};

const udonNoodles: Ingredient = {
  id: "i1",
  name: "Udon noodles",
  stockUnit: "g",
  isHandDepleted: false,
  lastPurchasedAmount: null,
  status: "active",
  createdAt: "2026-01-01T00:00:00Z",
};

const garlic: Ingredient = {
  id: "i2",
  name: "Garlic",
  stockUnit: "cloves",
  isHandDepleted: false,
  lastPurchasedAmount: null,
  status: "active",
  createdAt: "2026-01-01T00:00:00Z",
};

describe("ShopsPage", () => {
  beforeEach(() => {
    listShops.mockReset().mockResolvedValue([lidl, asianSupermarket]);
    createShop.mockReset();
    renameShop.mockReset();
    deleteShop.mockReset();
    reorderShops.mockReset();
    listAisles.mockReset().mockResolvedValue([dryGoods, fruitVeg]);
    createAisle.mockReset();
    updateAisle.mockReset();
    deleteAisle.mockReset();
    reorderAisles.mockReset();
    listPlacementsForAisle.mockReset().mockResolvedValue([]);
    addPlacement.mockReset();
    removePlacement.mockReset();
    listIngredients.mockReset().mockResolvedValue([udonNoodles, garlic]);
  });

  it("renders without crashing and shows loaded Shops", async () => {
    render(<ShopsPage />);

    expect(screen.getByRole("heading", { name: "Shops" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("Lidl")).toBeInTheDocument();
    });
    expect(screen.getByText("Asian Supermarket")).toBeInTheDocument();
  });

  it("shows an empty state when there are no Shops", async () => {
    listShops.mockResolvedValue([]);
    render(<ShopsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("shops-empty")).toBeInTheDocument();
    });
  });

  it("shows an error state when loading Shops fails", async () => {
    listShops.mockRejectedValue(new Error("network down"));
    render(<ShopsPage />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("network down");
    });
  });

  it("creates a Shop by name", async () => {
    createShop.mockResolvedValue({ ...lidl, id: "s3", name: "Tesco" });
    render(<ShopsPage />);

    await waitFor(() => expect(screen.getByText("Lidl")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Tesco" } });
    fireEvent.click(screen.getByRole("button", { name: /add shop/i }));

    await waitFor(() => {
      expect(createShop).toHaveBeenCalledWith({}, "Tesco");
    });
    expect(listShops).toHaveBeenCalledTimes(2);
  });

  it("renames a Shop", async () => {
    renameShop.mockResolvedValue({ ...lidl, name: "Lidl UK" });
    render(<ShopsPage />);

    await waitFor(() => expect(screen.getByText("Lidl")).toBeInTheDocument());

    const lidlRow = screen.getByText("Lidl").closest("li")!;
    fireEvent.click(within(lidlRow).getByRole("button", { name: /rename/i }));
    fireEvent.change(within(lidlRow).getByLabelText("Name for Lidl"), {
      target: { value: "Lidl UK" },
    });
    fireEvent.click(within(lidlRow).getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(renameShop).toHaveBeenCalledWith({}, "s1", "Lidl UK");
    });
  });

  it("deletes a Shop", async () => {
    deleteShop.mockResolvedValue(undefined);
    render(<ShopsPage />);

    await waitFor(() => expect(screen.getByText("Lidl")).toBeInTheDocument());

    const lidlRow = screen.getByText("Lidl").closest("li")!;
    fireEvent.click(within(lidlRow).getByRole("button", { name: /delete/i }));

    await waitFor(() => {
      expect(deleteShop).toHaveBeenCalledWith({}, "s1");
    });
  });

  it("reorders Shops by moving one down", async () => {
    reorderShops.mockResolvedValue(undefined);
    render(<ShopsPage />);

    await waitFor(() => expect(screen.getByText("Lidl")).toBeInTheDocument());

    const lidlRow = screen.getByText("Lidl").closest("li")!;
    fireEvent.click(within(lidlRow).getByRole("button", { name: /move lidl down/i }));

    await waitFor(() => {
      expect(reorderShops).toHaveBeenCalledWith({}, ["s2", "s1"]);
    });
  });

  it("drills into a Shop to show its Aisles in order", async () => {
    render(<ShopsPage />);

    await waitFor(() => expect(screen.getByText("Lidl")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Lidl"));

    await waitFor(() => {
      expect(listAisles).toHaveBeenCalledWith({}, "s1");
    });
    expect(screen.getByText("Dry Goods")).toBeInTheDocument();
    expect(screen.getByText("🥬 Fruit & Veg")).toBeInTheDocument();
  });

  it("creates an Aisle with a name and emoji within a Shop", async () => {
    createAisle.mockResolvedValue({ ...dryGoods, id: "a3", name: "Bakery", emoji: "🍞" });
    render(<ShopsPage />);

    await waitFor(() => expect(screen.getByText("Lidl")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Lidl"));
    await waitFor(() => expect(screen.getByText("Dry Goods")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Emoji"), { target: { value: "🍞" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Bakery" } });
    fireEvent.click(screen.getByRole("button", { name: /add aisle/i }));

    await waitFor(() => {
      expect(createAisle).toHaveBeenCalledWith({}, { shopId: "s1", name: "Bakery", emoji: "🍞" });
    });
  });

  it("reorders Aisles within a Shop by moving one down", async () => {
    reorderAisles.mockResolvedValue(undefined);
    render(<ShopsPage />);

    await waitFor(() => expect(screen.getByText("Lidl")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Lidl"));
    await waitFor(() => expect(screen.getByText("Dry Goods")).toBeInTheDocument());

    const dryGoodsRow = screen.getByText("Dry Goods").closest("li")!;
    fireEvent.click(within(dryGoodsRow).getByRole("button", { name: /move dry goods down/i }));

    await waitFor(() => {
      expect(reorderAisles).toHaveBeenCalledWith({}, "s1", ["a2", "a1"]);
    });
  });

  it("deletes an Aisle", async () => {
    deleteAisle.mockResolvedValue(undefined);
    render(<ShopsPage />);

    await waitFor(() => expect(screen.getByText("Lidl")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Lidl"));
    await waitFor(() => expect(screen.getByText("Dry Goods")).toBeInTheDocument());

    const dryGoodsRow = screen.getByText("Dry Goods").closest("li")!;
    fireEvent.click(within(dryGoodsRow).getByRole("button", { name: /delete/i }));

    await waitFor(() => {
      expect(deleteAisle).toHaveBeenCalledWith({}, "a1");
    });
  });

  it("attaches an Ingredient to an Aisle, creating a Placement", async () => {
    addPlacement.mockResolvedValue({
      id: "p1",
      ingredientId: "i1",
      aisleId: "a1",
      createdAt: "2026-01-01T00:00:00Z",
    });
    render(<ShopsPage />);

    await waitFor(() => expect(screen.getByText("Lidl")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Lidl"));
    await waitFor(() => expect(screen.getByText("Dry Goods")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Dry Goods"));

    await waitFor(() => {
      expect(listPlacementsForAisle).toHaveBeenCalledWith({}, "a1");
    });

    fireEvent.change(screen.getByLabelText("Ingredient to attach"), {
      target: { value: "i1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /attach/i }));

    await waitFor(() => {
      expect(addPlacement).toHaveBeenCalledWith({}, { ingredientId: "i1", aisleId: "a1" });
    });
  });

  it("shows Placements already attached to an Aisle and can remove one", async () => {
    listPlacementsForAisle.mockResolvedValue([
      { id: "p1", ingredientId: "i1", aisleId: "a1", createdAt: "2026-01-01T00:00:00Z" },
    ]);
    removePlacement.mockResolvedValue(undefined);
    render(<ShopsPage />);

    await waitFor(() => expect(screen.getByText("Lidl")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Lidl"));
    await waitFor(() => expect(screen.getByText("Dry Goods")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Dry Goods"));

    await waitFor(() => {
      expect(screen.getByText("Udon noodles")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /remove/i }));

    await waitFor(() => {
      expect(removePlacement).toHaveBeenCalledWith({}, { ingredientId: "i1", aisleId: "a1" });
    });
  });

  it("shows an empty state when an Aisle has no Placements yet", async () => {
    render(<ShopsPage />);

    await waitFor(() => expect(screen.getByText("Lidl")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Lidl"));
    await waitFor(() => expect(screen.getByText("Dry Goods")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Dry Goods"));

    await waitFor(() => {
      expect(screen.getByTestId("placements-empty")).toBeInTheDocument();
    });
  });

  it("navigates back from a Shop's Aisles to the Shops list", async () => {
    render(<ShopsPage />);

    await waitFor(() => expect(screen.getByText("Lidl")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Lidl"));
    await waitFor(() => expect(screen.getByText("Dry Goods")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /all shops/i }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Shops" })).toBeInTheDocument();
    });
    expect(screen.getByText("Asian Supermarket")).toBeInTheDocument();
  });
});
