import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import RecipeDetailPage from "./page";
import type {
  RecipeInconsistency,
  RecipeLinePantryStatus,
  RecipeLineWithDetails,
  RecipeWithLines,
} from "@/lib/recipes/types";
import type { Ingredient } from "@/lib/ingredients/types";

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "r1" }),
  useRouter: () => ({ push }),
}));

const getRecipeWithLines = vi.fn();
const listInconsistencies = vi.fn();
const listLineStatuses = vi.fn();
const rateRecipe = vi.fn();
const updateRecipe = vi.fn();
const addTag = vi.fn();
const removeTag = vi.fn();
const addLine = vi.fn();
const updateLine = vi.fn();
const removeLine = vi.fn();
const reorderLines = vi.fn();
const resolveLine = vi.fn();
const addSubstitute = vi.fn();
const removeSubstitute = vi.fn();

vi.mock("@/lib/recipes/recipes", async () => {
  const actual = await vi.importActual<typeof import("@/lib/recipes/recipes")>(
    "@/lib/recipes/recipes"
  );
  return {
    ...actual,
    getRecipeWithLines: (...args: unknown[]) => getRecipeWithLines(...args),
    listInconsistencies: (...args: unknown[]) => listInconsistencies(...args),
    listLineStatuses: (...args: unknown[]) => listLineStatuses(...args),
    rateRecipe: (...args: unknown[]) => rateRecipe(...args),
    updateRecipe: (...args: unknown[]) => updateRecipe(...args),
    addTag: (...args: unknown[]) => addTag(...args),
    removeTag: (...args: unknown[]) => removeTag(...args),
    addLine: (...args: unknown[]) => addLine(...args),
    updateLine: (...args: unknown[]) => updateLine(...args),
    removeLine: (...args: unknown[]) => removeLine(...args),
    reorderLines: (...args: unknown[]) => reorderLines(...args),
    resolveLine: (...args: unknown[]) => resolveLine(...args),
    addSubstitute: (...args: unknown[]) => addSubstitute(...args),
    removeSubstitute: (...args: unknown[]) => removeSubstitute(...args),
  };
});

const listIngredients = vi.fn();
const resolveIngredientName = vi.fn();

vi.mock("@/lib/ingredients/registry", () => ({
  listIngredients: (...args: unknown[]) => listIngredients(...args),
  resolveIngredientName: (...args: unknown[]) => resolveIngredientName(...args),
}));

const mirin: Ingredient = {
  id: "i-mirin",
  name: "Mirin",
  stockUnit: "ml",
  isHandDepleted: false,
  lastPurchasedAmount: null,
  status: "active",
  createdAt: "2026-01-01T00:00:00Z",
};

const riceWine: Ingredient = {
  id: "i-rice-wine",
  name: "Rice wine",
  stockUnit: "ml",
  isHandDepleted: false,
  lastPurchasedAmount: null,
  status: "active",
  createdAt: "2026-01-01T00:00:00Z",
};

const mirinLine: RecipeLineWithDetails = {
  id: "l1",
  recipeId: "r1",
  ingredientId: "i-mirin",
  rawName: null,
  amount: 30,
  unit: "ml",
  note: "just a splash",
  isEssential: false,
  position: 0,
  createdAt: "2026-01-01T00:00:00Z",
  ingredientName: "Mirin",
  stockUnit: "ml",
  isHandDepleted: false,
  substitutes: [],
};

const unresolvedLine: RecipeLineWithDetails = {
  id: "l2",
  recipeId: "r1",
  ingredientId: null,
  rawName: "Leak",
  amount: 2,
  unit: "pieces",
  note: null,
  isEssential: false,
  position: 1,
  createdAt: "2026-01-01T00:00:00Z",
  ingredientName: null,
  stockUnit: null,
  isHandDepleted: null,
  substitutes: [],
};

const stirFry: RecipeWithLines = {
  id: "r1",
  name: "Chicken Stir-fry",
  servings: 4,
  maxMultiplier: 3,
  rating: 4,
  prepMinutes: 10,
  cookMinutes: 15,
  source: "family recipe",
  steps: "Fry everything.",
  createdAt: "2026-01-01T00:00:00Z",
  tags: ["dairy", "quick"],
  lines: [mirinLine, unresolvedLine],
};

describe("RecipeDetailPage", () => {
  beforeEach(() => {
    getRecipeWithLines.mockReset().mockResolvedValue(stirFry);
    listInconsistencies.mockReset().mockResolvedValue([
      {
        recipeLineId: "l2",
        recipeId: "r1",
        reason: "unresolved_ingredient",
        lineLabel: "Leak",
      } satisfies RecipeInconsistency,
    ]);
    listLineStatuses.mockReset().mockResolvedValue([
      {
        recipeLineId: "l1",
        recipeId: "r1",
        ingredientId: "i-mirin",
        isEssential: false,
        status: "available",
      } satisfies RecipeLinePantryStatus,
      {
        recipeLineId: "l2",
        recipeId: "r1",
        ingredientId: null,
        isEssential: false,
        status: "missing",
      } satisfies RecipeLinePantryStatus,
    ]);
    listIngredients.mockReset().mockResolvedValue([mirin, riceWine]);
    resolveIngredientName.mockReset().mockResolvedValue({ resolved: false, candidates: [] });
    rateRecipe.mockReset().mockResolvedValue(stirFry);
    updateRecipe.mockReset().mockResolvedValue(stirFry);
    addTag.mockReset().mockResolvedValue(undefined);
    removeTag.mockReset().mockResolvedValue(undefined);
    addLine.mockReset().mockResolvedValue(mirinLine);
    updateLine.mockReset().mockResolvedValue(mirinLine);
    removeLine.mockReset().mockResolvedValue(undefined);
    reorderLines.mockReset().mockResolvedValue(undefined);
    resolveLine.mockReset().mockResolvedValue(unresolvedLine);
    addSubstitute.mockReset().mockResolvedValue(undefined);
    removeSubstitute.mockReset().mockResolvedValue(undefined);
    push.mockReset();
  });

  it("renders without crashing and shows the Recipe name once loaded", async () => {
    render(<RecipeDetailPage />);
    expect(await screen.findByRole("heading", { name: "Chicken Stir-fry" })).toBeInTheDocument();
  });

  it("shows Allergen Flags derived from tags", async () => {
    render(<RecipeDetailPage />);
    await screen.findByRole("heading", { name: "Chicken Stir-fry" });
    expect(screen.getByText(/Allergen Flags:/)).toHaveTextContent("dairy");
  });

  it("lists Inconsistencies with their reason", async () => {
    render(<RecipeDetailPage />);
    const panel = await screen.findByTestId("inconsistencies");
    expect(within(panel).getByText("Leak")).toBeInTheDocument();
    expect(within(panel).getByText(/Ingredient not matched yet/)).toBeInTheDocument();
  });

  it("shows the reading view by default with per-line Pantry status", async () => {
    render(<RecipeDetailPage />);
    await screen.findByRole("heading", { name: "Chicken Stir-fry" });
    expect(screen.getByText("In stock")).toBeInTheDocument();
    expect(screen.getAllByText("Missing").length).toBeGreaterThan(0);
    expect(screen.getByText("Fry everything.")).toBeInTheDocument();
  });

  it("shows an error state when loading fails", async () => {
    getRecipeWithLines.mockReset().mockRejectedValue(new Error("network down"));
    render(<RecipeDetailPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("network down");
  });

  it("shows a not-found message when the Recipe does not exist", async () => {
    getRecipeWithLines.mockReset().mockResolvedValue(null);
    render(<RecipeDetailPage />);
    expect(await screen.findByText("Recipe not found.")).toBeInTheDocument();
  });

  it("rates the Recipe independent of cooking it", async () => {
    render(<RecipeDetailPage />);
    await screen.findByRole("heading", { name: "Chicken Stir-fry" });

    fireEvent.click(screen.getByLabelText("Rate 5 out of 5"));

    await waitFor(() => expect(rateRecipe).toHaveBeenCalledWith({}, "r1", 5));
  });

  it("switches to the Editing view and back", async () => {
    render(<RecipeDetailPage />);
    await screen.findByRole("heading", { name: "Chicken Stir-fry" });

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("button", { name: "Save details" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Read" }));
    expect(screen.queryByRole("button", { name: "Save details" })).not.toBeInTheDocument();
  });

  it("navigates back to the Recipes list", async () => {
    render(<RecipeDetailPage />);
    await screen.findByRole("heading", { name: "Chicken Stir-fry" });

    fireEvent.click(screen.getByText("← Recipes"));
    expect(push).toHaveBeenCalledWith("/recipes");
  });
});
