import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import RecipeDetailPage from "./page";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "r1" }), useRouter: () => ({ push: vi.fn() }) }));
const getRecipeWithLines = vi.fn();
const listInconsistencies = vi.fn();
const listLineStatuses = vi.fn();
const rateRecipe = vi.fn();
vi.mock("@/lib/recipes/recipes", () => ({
  getRecipeWithLines: (...args: unknown[]) => getRecipeWithLines(...args),
  listInconsistencies: (...args: unknown[]) => listInconsistencies(...args),
  listLineStatuses: (...args: unknown[]) => listLineStatuses(...args),
  rateRecipe: (...args: unknown[]) => rateRecipe(...args),
  addLine: vi.fn(), addSubstitute: vi.fn(), addTag: vi.fn(), allergenFlagsFromTags: () => [], removeLine: vi.fn(), removeSubstitute: vi.fn(), removeTag: vi.fn(), reorderLines: vi.fn(), resolveLine: vi.fn(), updateLine: vi.fn(), updateRecipe: vi.fn(),
}));
vi.mock("@/lib/ingredients/registry", () => ({ listIngredients: vi.fn().mockResolvedValue([]), resolveIngredientName: vi.fn(), createIngredient: vi.fn() }));
const previewCook = vi.fn();
const commitCook = vi.fn();
vi.mock("@/lib/meals", () => ({ previewCook: (...args: unknown[]) => previewCook(...args), commitCook: (...args: unknown[]) => commitCook(...args) }));

const recipe = {
  id: "r1", name: "Chicken bowl", servings: 2, maxMultiplier: 3, rating: null, prepMinutes: null, cookMinutes: null, source: null, steps: null, createdAt: "2026-08-01T00:00:00Z", tags: [],
  lines: [{ id: "l1", recipeId: "r1", ingredientId: "i1", rawName: null, amount: 30, unit: "ml", note: null, isEssential: false, position: 0, createdAt: "2026-08-01T00:00:00Z", ingredientName: "Mirin", stockUnit: "ml", isHandDepleted: false, substitutes: [{ id: "s1", recipeLineId: "l1", ingredientId: "i2", ingredientName: "Rice wine", createdAt: "2026-08-01T00:00:00Z" }] }],
};

describe("RecipeDetailPage Cook flow", () => {
  beforeEach(() => {
    getRecipeWithLines.mockReset().mockResolvedValue(recipe);
    listInconsistencies.mockReset().mockResolvedValue([]);
    listLineStatuses.mockReset().mockResolvedValue([{ recipeLineId: "l1", recipeId: "r1", ingredientId: "i1", isEssential: false, status: "missing" }]);
    rateRecipe.mockReset();
    previewCook.mockReset().mockResolvedValue({ recipeId: "r1", recipeName: "Chicken bowl", multiplier: 1, portionsProduced: 2, lines: [{ recipeLineId: "l1", ingredientName: "Rice wine", stockUnit: "ml", requested: 30, availableQuantity: 20, willDeplete: 20, shortfall: 10, issue: null, substituteIngredientId: "i2", substitutes: [] }] });
    commitCook.mockReset().mockResolvedValue({});
  });

  it("previews selected Substitute and confirms exact shortfall before an off-plan Cook", async () => {
    render(<RecipeDetailPage />);
    await screen.findByRole("heading", { name: "Chicken bowl" });
    fireEvent.change(screen.getByLabelText("Use substitute for Mirin"), { target: { value: "i2" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview Cook" }));
    await waitFor(() => expect(previewCook).toHaveBeenCalledWith({}, { recipeId: "r1", multiplier: 1, substitutions: [{ recipeLineId: "l1", substituteIngredientId: "i2" }] }));
    expect(screen.getByText(/Short by 10 ml/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/clamped at zero/);
    fireEvent.click(screen.getByRole("button", { name: "Cook anyway" }));
    await waitFor(() => expect(commitCook).toHaveBeenCalledWith({}, { recipeId: "r1", multiplier: 1, substitutions: [{ recipeLineId: "l1", substituteIngredientId: "i2" }] }));
  });
});
