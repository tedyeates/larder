import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import PlanPage from "./page";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
const listMealPlanSlots = vi.fn();
const saveMealPlanSlot = vi.fn();
const clearMealPlanSlot = vi.fn();
const topUpMealPlanSlot = vi.fn();
const previewPlanCook = vi.fn();
const commitPlanCook = vi.fn();
const eatMealPlanSlot = vi.fn();
const ateOutMealPlanSlot = vi.fn();
vi.mock("@/lib/plan/plan", () => ({
  listMealPlanSlots: (...args: unknown[]) => listMealPlanSlots(...args),
  saveMealPlanSlot: (...args: unknown[]) => saveMealPlanSlot(...args),
  clearMealPlanSlot: (...args: unknown[]) => clearMealPlanSlot(...args),
  topUpMealPlanSlot: (...args: unknown[]) => topUpMealPlanSlot(...args),
  previewPlanCook: (...args: unknown[]) => previewPlanCook(...args),
  commitPlanCook: (...args: unknown[]) => commitPlanCook(...args),
  eatMealPlanSlot: (...args: unknown[]) => eatMealPlanSlot(...args),
  ateOutMealPlanSlot: (...args: unknown[]) => ateOutMealPlanSlot(...args),
}));
const listRecipes = vi.fn();
vi.mock("@/lib/recipes/recipes", () => ({ listRecipes: (...args: unknown[]) => listRecipes(...args) }));

function isoDate(date: Date): string { return date.toISOString().slice(0, 10); }
function addDays(date: Date, days: number): Date { const value = new Date(date); value.setUTCDate(value.getUTCDate() + days); return value; }
function weekStart(date: Date): string { const value = new Date(`${isoDate(date)}T00:00:00Z`); value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7)); return isoDate(value); }

const recipes = [{ id: "r1", name: "Chicken bowl", servings: 2, maxMultiplier: 3 }];
let today = "";
let nextMonday = "";
let currentWeek = "";
let followingWeek = "";

describe("PlanPage", () => {
  beforeEach(() => {
    const now = new Date();
    today = isoDate(now);
    currentWeek = weekStart(now);
    nextMonday = isoDate(addDays(new Date(`${currentWeek}T00:00:00Z`), 7));
    followingWeek = nextMonday;
    listMealPlanSlots.mockReset().mockResolvedValue([
      {
        id: "s1", slotDate: today, mealTime: "dinner", recipeId: "r1", recipeName: "Chicken bowl", label: null,
        isCook: true, cookMultiplier: 2, cookId: null, isCookable: false, shortfall: true,
        lineStatuses: [{ recipeLineId: "l1", ingredientName: "Chicken", status: "missing" }, { recipeLineId: "l2", ingredientName: "Rice wine", status: "fulfilled_by_substitute" }],
      },
      {
        // Guaranteed to render read-only if it falls before today AND inside
        // the visible Mon–Sun grid. On a Monday, `currentWeek === today` and
        // no earlier day exists in the visible grid — in that case this slot
        // simply won't render as past, so the assertion below tolerates zero
        // matches only on that one weekday.
        id: "old", slotDate: currentWeek, mealTime: "breakfast", recipeId: null, recipeName: null, label: "Toast",
        isCook: false, cookMultiplier: 1, cookId: null, isCookable: null, shortfall: false, lineStatuses: [],
      },
    ]);
    listRecipes.mockReset().mockResolvedValue(recipes);
    saveMealPlanSlot.mockReset().mockResolvedValue({});
    clearMealPlanSlot.mockReset().mockResolvedValue({});
    topUpMealPlanSlot.mockReset().mockResolvedValue({});
    previewPlanCook.mockReset().mockResolvedValue({ recipeId: "r1", recipeName: "Chicken bowl", multiplier: 2, portionsProduced: 4, lines: [] });
    commitPlanCook.mockReset().mockResolvedValue({});
    eatMealPlanSlot.mockReset().mockResolvedValue({});
    ateOutMealPlanSlot.mockReset().mockResolvedValue({});
  });

  afterEach(() => vi.clearAllMocks());

  it("opens current week, navigates, and fills a future slot with free text", async () => {
    render(<PlanPage />);
    expect(await screen.findByRole("heading", { name: "Meal Plan" })).toBeInTheDocument();
    expect(screen.getByText(`Week of ${currentWeek}`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(screen.getByText(`Week of ${followingWeek}`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: `Add breakfast on ${nextMonday}` }));
    fireEvent.change(screen.getByLabelText("Free-text meal"), { target: { value: "Porridge" } });
    fireEvent.click(screen.getByRole("button", { name: "Save slot" }));
    await waitFor(() => expect(saveMealPlanSlot).toHaveBeenCalledWith({}, expect.objectContaining({ slotDate: nextMonday, mealTime: "breakfast", label: "Porridge" })));
  });

  it("shows plan warnings and acts only when user chooses Top-Up, Cook, Eaten, or Ate Out", async () => {
    render(<PlanPage />);
    await screen.findByText("Chicken bowl");
    expect(screen.getByText("Chicken: Missing")).toBeInTheDocument();
    expect(screen.getByText("Rice wine: Fulfilled by Substitute")).toBeInTheDocument();
    expect(screen.getByText("Shortfall")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Read Chicken bowl recipe" })).toHaveAttribute("href", "/recipes/r1");
    fireEvent.click(screen.getByRole("button", { name: "Top up Chicken bowl" }));
    await waitFor(() => expect(topUpMealPlanSlot).toHaveBeenCalledWith({}, "s1"));
    fireEvent.click(screen.getByRole("button", { name: "Preview cook Chicken bowl" }));
    expect(await screen.findByText("Makes 4 Portions")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cook anyway" }));
    await waitFor(() => expect(commitPlanCook).toHaveBeenCalledWith({}, "s1", []));
    fireEvent.click(screen.getByRole("button", { name: "Mark Chicken bowl eaten" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark Chicken bowl ate out" }));
    await waitFor(() => expect(eatMealPlanSlot).toHaveBeenCalledWith({}, "s1"));
    await waitFor(() => expect(ateOutMealPlanSlot).toHaveBeenCalledWith({}, "s1"));
    if (currentWeek !== today) {
      expect(screen.getAllByText("Past slot — read-only").length).toBeGreaterThan(0);
    }
  });

  it("previews and commits with the Substitute chosen from a slot, same as the Recipe page", async () => {
    previewPlanCook.mockResolvedValue({
      recipeId: "r1", recipeName: "Chicken bowl", multiplier: 2, portionsProduced: 4,
      lines: [{
        recipeLineId: "l2", ingredientId: null, ingredientName: "Rice wine", stockUnit: "ml",
        requested: 0, availableQuantity: 0, willDeplete: 0, shortfall: 0, issue: null,
        substituteIngredientId: null,
        substitutes: [{ ingredientId: "sub-1", ingredientName: "Mirin", availableQuantity: 20 }],
      }],
    });
    render(<PlanPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Preview cook Chicken bowl" }));
    await screen.findByText("Makes 4 Portions");

    fireEvent.change(screen.getByLabelText("Use substitute for Rice wine"), { target: { value: "sub-1" } });
    await waitFor(() =>
      expect(previewPlanCook).toHaveBeenLastCalledWith({}, "s1", [{ recipeLineId: "l2", substituteIngredientId: "sub-1" }])
    );

    fireEvent.click(screen.getByRole("button", { name: "Cook anyway" }));
    await waitFor(() =>
      expect(commitPlanCook).toHaveBeenCalledWith({}, "s1", [{ recipeLineId: "l2", substituteIngredientId: "sub-1" }])
    );
  });

  it("renders loading, error, and empty states", async () => {
    listMealPlanSlots.mockReset().mockReturnValue(new Promise(() => {}));
    listRecipes.mockReset().mockReturnValue(new Promise(() => {}));
    const loading = render(<PlanPage />);
    expect(screen.getByText("Loading plan…")).toBeInTheDocument();
    loading.unmount();
    listMealPlanSlots.mockReset().mockRejectedValue(new Error("offline"));
    listRecipes.mockReset().mockResolvedValue(recipes);
    const failed = render(<PlanPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    failed.unmount();
    listMealPlanSlots.mockReset().mockResolvedValue([]);
    listRecipes.mockReset().mockResolvedValue(recipes);
    render(<PlanPage />);
    expect(await screen.findByText(/No meals planned this week/)).toBeInTheDocument();
  });
});
