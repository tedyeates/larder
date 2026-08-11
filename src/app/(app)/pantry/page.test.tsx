import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import PantryPage from "./page";
import type { PantrySummaryRow } from "@/lib/pantry/types";
import type { Ingredient } from "@/lib/ingredients/types";

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

const listPantrySummary = vi.fn();
const listStockLots = vi.fn();
const addStock = vi.fn();
const consumeStock = vi.fn();
const setHandDepletedFraction = vi.fn();
const updateStockLot = vi.fn();
const deleteStockLot = vi.fn();

vi.mock("@/lib/pantry/pantry", () => ({
  listPantrySummary: (...args: unknown[]) => listPantrySummary(...args),
  listStockLots: (...args: unknown[]) => listStockLots(...args),
  addStock: (...args: unknown[]) => addStock(...args),
  consumeStock: (...args: unknown[]) => consumeStock(...args),
  setHandDepletedFraction: (...args: unknown[]) => setHandDepletedFraction(...args),
  updateStockLot: (...args: unknown[]) => updateStockLot(...args),
  deleteStockLot: (...args: unknown[]) => deleteStockLot(...args),
}));

const listIngredients = vi.fn();
vi.mock("@/lib/ingredients/registry", () => ({
  listIngredients: (...args: unknown[]) => listIngredients(...args),
}));

const chickenIngredient: Ingredient = {
  id: "i1",
  name: "Chicken thighs",
  stockUnit: "pieces",
  isHandDepleted: false,
  lastPurchasedAmount: null,
  status: "active",
  createdAt: "2026-01-01T00:00:00Z",
};

const soySauceIngredient: Ingredient = {
  id: "i2",
  name: "Soy sauce",
  stockUnit: "bottle",
  isHandDepleted: true,
  lastPurchasedAmount: null,
  status: "active",
  createdAt: "2026-01-01T00:00:00Z",
};

const chickenRow: PantrySummaryRow = {
  ingredientId: "i1",
  ingredientName: "Chicken thighs",
  stockUnit: "pieces",
  isHandDepleted: false,
  storageLocation: "fridge",
  totalQuantity: 6,
  oldestAcquiredOn: "2026-01-01",
  lotCount: 2,
};

const soySauceRow: PantrySummaryRow = {
  ingredientId: "i2",
  ingredientName: "Soy sauce",
  stockUnit: "bottle",
  isHandDepleted: true,
  storageLocation: "cupboard",
  totalQuantity: 0.5,
  oldestAcquiredOn: "2026-01-01",
  lotCount: 1,
};

describe("PantryPage", () => {
  beforeEach(() => {
    listPantrySummary.mockReset().mockResolvedValue([chickenRow, soySauceRow]);
    listIngredients.mockReset().mockResolvedValue([chickenIngredient, soySauceIngredient]);
    listStockLots.mockReset().mockResolvedValue([]);
    addStock.mockReset();
    consumeStock.mockReset();
    setHandDepletedFraction.mockReset();
    updateStockLot.mockReset();
    deleteStockLot.mockReset();
  });

  it("renders without crashing and shows Pantry rows grouped by Storage Location", async () => {
    render(<PantryPage />);

    expect(screen.getByRole("heading", { name: "Pantry" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "Fridge" })).toBeInTheDocument();
    });
    expect(screen.getByRole("region", { name: "Cupboard" })).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Fridge" })).getByText("Chicken thighs")
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Cupboard" })).getByText("Soy sauce")
    ).toBeInTheDocument();
  });

  it("shows an empty state when there is no stock", async () => {
    listPantrySummary.mockResolvedValue([]);
    render(<PantryPage />);

    await waitFor(() => {
      expect(screen.getByTestId("pantry-empty")).toBeInTheDocument();
    });
  });

  it("shows an error state when loading fails", async () => {
    listPantrySummary.mockRejectedValue(new Error("network down"));
    render(<PantryPage />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("network down");
    });
  });

  it("shows an age badge derived from the oldest Lot", async () => {
    render(<PantryPage />);

    await waitFor(() => expect(screen.getByRole("region", { name: "Fridge" })).toBeInTheDocument());
    const chickenButton = within(screen.getByRole("region", { name: "Fridge" })).getByRole(
      "button",
      { name: /Chicken thighs/i }
    );
    expect(within(chickenButton).getByTestId("age-badge")).toBeInTheDocument();
  });

  it("adds stock for an Auto-Depleted Ingredient via addStock", async () => {
    addStock.mockResolvedValue({
      id: "l1",
      ingredientId: "i1",
      quantity: 4,
      storageLocation: "fridge",
      acquiredOn: "2026-01-05",
      createdAt: "2026-01-05T00:00:00Z",
    });
    render(<PantryPage />);

    await waitFor(() => expect(screen.getByRole("region", { name: "Fridge" })).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Ingredient"), { target: { value: "i1" } });
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-01-05" } });
    fireEvent.click(screen.getByRole("button", { name: /add stock/i }));

    await waitFor(() => {
      expect(addStock).toHaveBeenCalledWith(
        {},
        {
          ingredientId: "i1",
          quantity: 4,
          storageLocation: "fridge",
          acquiredOn: "2026-01-05",
        }
      );
    });
  });

  it("routes a Hand-Depleted Ingredient's add through setHandDepletedFraction instead of addStock", async () => {
    setHandDepletedFraction.mockResolvedValue({
      id: "l2",
      ingredientId: "i2",
      quantity: 1,
      storageLocation: "cupboard",
      acquiredOn: "2026-01-05",
      createdAt: "2026-01-05T00:00:00Z",
    });
    render(<PantryPage />);

    await waitFor(() => expect(screen.getByRole("region", { name: "Fridge" })).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Ingredient"), { target: { value: "i2" } });
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Storage Location"), { target: { value: "cupboard" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-01-05" } });
    fireEvent.click(screen.getByRole("button", { name: /add stock/i }));

    await waitFor(() => {
      expect(setHandDepletedFraction).toHaveBeenCalledWith(
        {},
        {
          ingredientId: "i2",
          quantity: 1,
          storageLocation: "cupboard",
          acquiredOn: "2026-01-05",
        }
      );
    });
    expect(addStock).not.toHaveBeenCalled();
  });

  it("consumes stock for an Auto-Depleted Ingredient and reports a shortfall", async () => {
    consumeStock.mockResolvedValue({ ingredientId: "i1", requested: 10, consumed: 6, shortfall: 4 });
    render(<PantryPage />);

    await waitFor(() => expect(screen.getByRole("region", { name: "Fridge" })).toBeInTheDocument());

    const chickenRowEl = screen
      .getByRole("region", { name: "Fridge" })
      .querySelector("li")!;
    fireEvent.change(within(chickenRowEl).getByLabelText(/consume chicken thighs/i), {
      target: { value: "10" },
    });
    fireEvent.click(within(chickenRowEl).getByRole("button", { name: /^consume$/i }));

    await waitFor(() => {
      expect(consumeStock).toHaveBeenCalledWith({}, "i1", 10);
    });
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("short by 4");
    });
  });

  it("sets a Hand-Depleted Ingredient's fraction directly rather than consuming", async () => {
    setHandDepletedFraction.mockResolvedValue({
      id: "l2",
      ingredientId: "i2",
      quantity: 0.25,
      storageLocation: "cupboard",
      acquiredOn: "2026-01-01",
      createdAt: "2026-01-01T00:00:00Z",
    });
    render(<PantryPage />);

    await waitFor(() => expect(screen.getByRole("region", { name: "Cupboard" })).toBeInTheDocument());

    const soySauceRowEl = screen
      .getByRole("region", { name: "Cupboard" })
      .querySelector("li")!;
    fireEvent.change(within(soySauceRowEl).getByLabelText(/set fraction remaining/i), {
      target: { value: "0.25" },
    });
    fireEvent.click(within(soySauceRowEl).getByRole("button", { name: /^set$/i }));

    await waitFor(() => {
      expect(setHandDepletedFraction).toHaveBeenCalledWith({}, {
        ingredientId: "i2",
        quantity: 0.25,
        storageLocation: "cupboard",
      });
    });
    expect(consumeStock).not.toHaveBeenCalled();
  });

  it("expands a row to show individual Lots", async () => {
    listStockLots.mockResolvedValue([
      {
        id: "l1",
        ingredientId: "i1",
        quantity: 4,
        storageLocation: "fridge",
        acquiredOn: "2026-01-01",
        createdAt: "2026-01-01T00:00:00Z",
      },
      {
        id: "l2",
        ingredientId: "i1",
        quantity: 2,
        storageLocation: "fridge",
        acquiredOn: "2026-01-03",
        createdAt: "2026-01-03T00:00:00Z",
      },
    ]);
    render(<PantryPage />);

    await waitFor(() => expect(screen.getByRole("region", { name: "Fridge" })).toBeInTheDocument());
    fireEvent.click(
      within(screen.getByRole("region", { name: "Fridge" })).getByRole("button", {
        name: /Chicken thighs/i,
      })
    );

    await waitFor(() => {
      expect(screen.getAllByTestId("stock-lot-row")).toHaveLength(2);
    });
  });

  it("edits a Lot's quantity by hand from the expanded view", async () => {
    listStockLots.mockResolvedValue([
      {
        id: "l1",
        ingredientId: "i1",
        quantity: 4,
        storageLocation: "fridge",
        acquiredOn: "2026-01-01",
        createdAt: "2026-01-01T00:00:00Z",
      },
    ]);
    updateStockLot.mockResolvedValue({
      id: "l1",
      ingredientId: "i1",
      quantity: 9,
      storageLocation: "fridge",
      acquiredOn: "2026-01-01",
      createdAt: "2026-01-01T00:00:00Z",
    });
    render(<PantryPage />);

    await waitFor(() => expect(screen.getByRole("region", { name: "Fridge" })).toBeInTheDocument());
    fireEvent.click(
      within(screen.getByRole("region", { name: "Fridge" })).getByRole("button", {
        name: /Chicken thighs/i,
      })
    );

    await waitFor(() => expect(screen.getAllByTestId("stock-lot-row")).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    const input = screen.getByLabelText(/quantity for lot acquired/i);
    fireEvent.change(input, { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(updateStockLot).toHaveBeenCalledWith({}, "l1", { quantity: 9 });
    });
  });

  it("deletes a Lot by hand from the expanded view", async () => {
    listStockLots.mockResolvedValue([
      {
        id: "l1",
        ingredientId: "i1",
        quantity: 4,
        storageLocation: "fridge",
        acquiredOn: "2026-01-01",
        createdAt: "2026-01-01T00:00:00Z",
      },
    ]);
    deleteStockLot.mockResolvedValue(undefined);
    render(<PantryPage />);

    await waitFor(() => expect(screen.getByRole("region", { name: "Fridge" })).toBeInTheDocument());
    fireEvent.click(
      within(screen.getByRole("region", { name: "Fridge" })).getByRole("button", {
        name: /Chicken thighs/i,
      })
    );

    await waitFor(() => expect(screen.getAllByTestId("stock-lot-row")).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));

    await waitFor(() => {
      expect(deleteStockLot).toHaveBeenCalledWith({}, "l1");
    });
  });
});
