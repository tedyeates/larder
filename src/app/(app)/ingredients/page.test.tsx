import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import IngredientsPage from "./page";
import type { Ingredient } from "@/lib/ingredients/types";

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

const listIngredients = vi.fn();
const createIngredient = vi.fn();
const updateIngredient = vi.fn();
const deleteIngredient = vi.fn();
const setHandDepleted = vi.fn();
const listAliases = vi.fn();
const listUnitConversions = vi.fn();
const addAlias = vi.fn();
const removeAlias = vi.fn();
const addUnitConversion = vi.fn();
const removeUnitConversion = vi.fn();

vi.mock("@/lib/ingredients/registry", () => ({
  listIngredients: (...args: unknown[]) => listIngredients(...args),
  createIngredient: (...args: unknown[]) => createIngredient(...args),
  updateIngredient: (...args: unknown[]) => updateIngredient(...args),
  deleteIngredient: (...args: unknown[]) => deleteIngredient(...args),
  setHandDepleted: (...args: unknown[]) => setHandDepleted(...args),
  listAliases: (...args: unknown[]) => listAliases(...args),
  listUnitConversions: (...args: unknown[]) => listUnitConversions(...args),
  addAlias: (...args: unknown[]) => addAlias(...args),
  removeAlias: (...args: unknown[]) => removeAlias(...args),
  addUnitConversion: (...args: unknown[]) => addUnitConversion(...args),
  removeUnitConversion: (...args: unknown[]) => removeUnitConversion(...args),
}));

const leek: Ingredient = {
  id: "i1",
  name: "Leek",
  stockUnit: "pieces",
  isHandDepleted: false,
  lastPurchasedAmount: null,
  status: "active",
  createdAt: "2026-01-01T00:00:00Z",
};

const soySauce: Ingredient = {
  id: "i5",
  name: "Soy sauce",
  stockUnit: "bottle",
  isHandDepleted: true,
  lastPurchasedAmount: null,
  status: "active",
  createdAt: "2026-01-01T00:00:00Z",
};

describe("IngredientsPage", () => {
  beforeEach(() => {
    listIngredients.mockReset().mockResolvedValue([leek, soySauce]);
    createIngredient.mockReset();
    updateIngredient.mockReset();
    deleteIngredient.mockReset();
    setHandDepleted.mockReset();
    listAliases.mockReset().mockResolvedValue([]);
    listUnitConversions.mockReset().mockResolvedValue([]);
    addAlias.mockReset();
    removeAlias.mockReset();
    addUnitConversion.mockReset();
    removeUnitConversion.mockReset();
  });

  it("renders without crashing and shows loaded Ingredients", async () => {
    render(<IngredientsPage />);

    expect(screen.getByRole("heading", { name: "Ingredients" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("Leek")).toBeInTheDocument();
    });
    expect(screen.getByText("Soy sauce")).toBeInTheDocument();
  });

  it("shows an empty state when there are no Ingredients", async () => {
    listIngredients.mockResolvedValue([]);
    render(<IngredientsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("ingredients-empty")).toBeInTheDocument();
    });
  });

  it("shows an error state when loading fails", async () => {
    listIngredients.mockRejectedValue(new Error("network down"));
    render(<IngredientsPage />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("network down");
    });
  });

  it("creates an Ingredient with a name and Stock Unit", async () => {
    createIngredient.mockResolvedValue({ ...leek, id: "i2", name: "Garlic", stockUnit: "cloves" });
    render(<IngredientsPage />);

    await waitFor(() => expect(screen.getByText("Leek")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Garlic" } });
    fireEvent.change(screen.getByLabelText("Stock Unit"), { target: { value: "cloves" } });
    fireEvent.click(screen.getByRole("button", { name: /add ingredient/i }));

    await waitFor(() => {
      expect(createIngredient).toHaveBeenCalledWith(
        {},
        { name: "Garlic", stockUnit: "cloves" }
      );
    });
    expect(listIngredients).toHaveBeenCalledTimes(2);
  });

  it("flags an Ingredient Hand-Depleted via the checkbox", async () => {
    setHandDepleted.mockResolvedValue({ ...leek, isHandDepleted: true });
    render(<IngredientsPage />);

    await waitFor(() => expect(screen.getByText("Leek")).toBeInTheDocument());

    const leekRow = screen.getByText("Leek").closest("li")!;
    const checkbox = within(leekRow).getByRole("checkbox", { name: /hand-depleted/i });
    fireEvent.click(checkbox);

    await waitFor(() => {
      expect(setHandDepleted).toHaveBeenCalledWith({}, "i1", true);
    });
  });

  it("deletes an Ingredient", async () => {
    deleteIngredient.mockResolvedValue(undefined);
    render(<IngredientsPage />);

    await waitFor(() => expect(screen.getByText("Leek")).toBeInTheDocument());

    const leekRow = screen.getByText("Leek").closest("li")!;
    fireEvent.click(within(leekRow).getByRole("button", { name: /delete/i }));

    await waitFor(() => {
      expect(deleteIngredient).toHaveBeenCalledWith({}, "i1");
    });
  });

  it("expands an Ingredient to manage its Aliases and Convertible Units", async () => {
    listAliases.mockResolvedValue([
      { id: "a1", ingredientId: "i1", alias: "Leak", createdAt: "2026-01-01T00:00:00Z" },
    ]);
    listUnitConversions.mockResolvedValue([
      { id: "u1", ingredientId: "i1", fromUnit: "cup", factorToStockUnit: 2, createdAt: "2026-01-01T00:00:00Z" },
    ]);
    render(<IngredientsPage />);

    await waitFor(() => expect(screen.getByText("Leek")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^Leek/i }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Aliases" })).toBeInTheDocument();
    });
    expect(screen.getByText("Leak")).toBeInTheDocument();
    expect(screen.getByText(/1 cup = 2/)).toBeInTheDocument();
  });

  it("adds an Alias from the expanded detail", async () => {
    addAlias.mockResolvedValue({ id: "a2", ingredientId: "i1", alias: "Leak", createdAt: "2026-01-01T00:00:00Z" });
    render(<IngredientsPage />);

    await waitFor(() => expect(screen.getByText("Leek")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^Leek/i }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Aliases" })).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("New alias"), { target: { value: "Leak" } });
    fireEvent.click(within(screen.getByLabelText("New alias").closest("form")!).getByRole("button", { name: /^Add$/i }));

    await waitFor(() => {
      expect(addAlias).toHaveBeenCalledWith({}, "i1", "Leak");
    });
  });

  it("adds a Convertible Unit factor from the expanded detail", async () => {
    addUnitConversion.mockResolvedValue({
      id: "u2",
      ingredientId: "i1",
      fromUnit: "cup",
      factorToStockUnit: 120,
      createdAt: "2026-01-01T00:00:00Z",
    });
    render(<IngredientsPage />);

    await waitFor(() => expect(screen.getByText("Leek")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^Leek/i }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Convertible Units" })).toBeInTheDocument()
    );

    fireEvent.change(screen.getByLabelText("Unit"), { target: { value: "cup" } });
    fireEvent.change(screen.getByLabelText("Factor to Stock Unit"), { target: { value: "120" } });
    fireEvent.click(within(screen.getByLabelText("Unit").closest("form")!).getByRole("button", { name: /^Add$/i }));

    await waitFor(() => {
      expect(addUnitConversion).toHaveBeenCalledWith({}, "i1", {
        fromUnit: "cup",
        factorToStockUnit: 120,
      });
    });
  });
});
