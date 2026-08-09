import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import MealsPage from "./page";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
const listMealStock = vi.fn();
const listPortionBatches = vi.fn();
const addPortionBatch = vi.fn();
const eatPortion = vi.fn();
const recordAteOut = vi.fn();
const updatePortionBatch = vi.fn();
vi.mock("@/lib/meals", () => ({
  listMealStock: (...args: unknown[]) => listMealStock(...args),
  listPortionBatches: (...args: unknown[]) => listPortionBatches(...args),
  addPortionBatch: (...args: unknown[]) => addPortionBatch(...args),
  eatPortion: (...args: unknown[]) => eatPortion(...args),
  recordAteOut: (...args: unknown[]) => recordAteOut(...args),
  updatePortionBatch: (...args: unknown[]) => updatePortionBatch(...args),
}));

const stock = [{ recipeId: "r1", label: null, displayName: "Chicken bowl", totalPortions: 3, oldestCookedOn: "2026-08-01", batchCount: 1 }];

describe("MealsPage", () => {
  beforeEach(() => {
    listMealStock.mockReset().mockResolvedValue(stock);
    listPortionBatches.mockReset().mockResolvedValue([{ id: "b1", recipeId: "r1", label: null, portionsRemaining: 3, storageLocation: "fridge", cookedOn: "2026-08-01", createdAt: "2026-08-01T00:00:00Z" }]);
    addPortionBatch.mockReset().mockResolvedValue({});
    eatPortion.mockReset().mockResolvedValue({});
    recordAteOut.mockReset().mockResolvedValue({});
    updatePortionBatch.mockReset().mockResolvedValue({});
  });

  it("renders Meal Stock with Portions and oldest Batch age", async () => {
    render(<MealsPage />);
    expect(await screen.findByRole("heading", { name: "Meal Stock" })).toBeInTheDocument();
    expect(screen.getByText(/Chicken bowl/)).toBeInTheDocument();
    expect(screen.getAllByText(/3 Portions.*2026-08-01/).length).toBeGreaterThan(0);
  });

  it("eats oldest available Portion and records Ate Out", async () => {
    render(<MealsPage />);
    await screen.findByText(/Chicken bowl/);
    fireEvent.click(screen.getByRole("button", { name: /Eat Chicken bowl/i }));
    await waitFor(() => expect(eatPortion).toHaveBeenCalledWith({}, expect.objectContaining({ recipeId: "r1" })));
    fireEvent.change(screen.getByLabelText("Ate Out description"), { target: { value: "Restaurant" } });
    fireEvent.click(screen.getByRole("button", { name: "Record Ate Out" }));
    await waitFor(() => expect(recordAteOut).toHaveBeenCalledWith({}, expect.objectContaining({ description: "Restaurant" })));
  });

  it("adds bought ready meal without Recipe", async () => {
    render(<MealsPage />);
    await screen.findByText(/Chicken bowl/);
    fireEvent.change(screen.getByLabelText("Ready meal name"), { target: { value: "Frozen pizza" } });
    fireEvent.change(screen.getByLabelText("Portions"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Add ready meal" }));
    await waitFor(() => expect(addPortionBatch).toHaveBeenCalledWith({}, expect.objectContaining({ label: "Frozen pizza", portions: 2 })));
  });

  it("edits Portion Batch count, location, and date by hand", async () => {
    render(<MealsPage />);
    await screen.findByText(/Chicken bowl/);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Portions for Recipe Batch"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Location for Recipe Batch"), { target: { value: "freezer" } });
    fireEvent.change(screen.getByLabelText("Date for Recipe Batch"), { target: { value: "2026-08-02" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updatePortionBatch).toHaveBeenCalledWith({}, "b1", {
      portionsRemaining: 5, storageLocation: "freezer", cookedOn: "2026-08-02",
    }));
  });
});
