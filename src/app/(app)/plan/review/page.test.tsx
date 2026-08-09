import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import PlanProposalReviewPage from "./page";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
const listPlanProposals = vi.fn();
const confirmPlanProposal = vi.fn();
const rejectPlanProposal = vi.fn();
const notifyPlannerOfRejectedProposal = vi.fn();
vi.mock("@/lib/plan/proposals", () => ({
  listPlanProposals: (...args: unknown[]) => listPlanProposals(...args),
  confirmPlanProposal: (...args: unknown[]) => confirmPlanProposal(...args),
  rejectPlanProposal: (...args: unknown[]) => rejectPlanProposal(...args),
}));
vi.mock("@/lib/planner/revisions", () => ({
  notifyPlannerOfRejectedProposal: (...args: unknown[]) => notifyPlannerOfRejectedProposal(...args),
}));

const proposal = {
  id: "proposal-1", planningHorizon: "2099-01-07", status: "review" as const,
  rejectionComment: null, rejectedAt: null, confirmedAt: null,
  existingRecipeTags: { "recipe-existing": ["dairy"] },
  bundle: {
    planningHorizon: "2099-01-07",
    slots: [
      { slotDate: "2099-01-01", mealTime: "dinner", recipeRef: "chili", isCook: true, cookMultiplier: 1 },
      { slotDate: "2099-01-02", mealTime: "dinner", recipeId: "recipe-existing", isCook: true, cookMultiplier: 1 },
    ],
    newIngredients: [{ ref: "beans", name: "Black beans", stockUnit: "g" }],
    suggestedAliases: [{ ingredientRef: "beans", alias: "Turtle beans" }],
    newRecipes: [{ ref: "chili", name: "Bean chili", servings: 2, maxMultiplier: 2, tags: ["vegan", "soy"], lines: [{ ingredientRef: "beans", amount: 200, unit: "g" }] }],
  },
};

describe("PlanProposalReviewPage", () => {
  beforeEach(() => {
    listPlanProposals.mockReset().mockResolvedValue([proposal]);
    confirmPlanProposal.mockReset().mockResolvedValue(undefined);
    rejectPlanProposal.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => vi.clearAllMocks());

  it("renders complete review bundle with visible Allergen Flags and confirms", async () => {
    render(<PlanProposalReviewPage />);
    expect(await screen.findByRole("heading", { name: "Plan Proposals" })).toBeInTheDocument();
    expect(screen.getByText("Bean chili")).toBeInTheDocument();
    expect(screen.getByText("Allergen Flags: soy")).toBeInTheDocument();
    expect(screen.getByText(/Black beans/)).toBeInTheDocument();
    expect(screen.getByText("Turtle beans")).toBeInTheDocument();
    expect(screen.getByText(/Allergen Flags: dairy/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm plan" }));
    await waitFor(() => expect(confirmPlanProposal).toHaveBeenCalledWith({}, "proposal-1"));
  });

  it("stores rejection comments through review action", async () => {
    render(<PlanProposalReviewPage />);
    await screen.findByText("Bean chili");
    fireEvent.change(screen.getByLabelText("Rejection comments for proposal-1"), { target: { value: "Keep Thursday empty" } });
    fireEvent.click(screen.getByRole("button", { name: "Reject with comments" }));
    await waitFor(() => {
      expect(rejectPlanProposal).toHaveBeenCalledWith({}, "proposal-1", "Keep Thursday empty");
      expect(notifyPlannerOfRejectedProposal).toHaveBeenCalledWith("proposal-1", "Keep Thursday empty");
    });
  });

  it("renders loading, error, and empty proposal states", async () => {
    listPlanProposals.mockReset().mockReturnValue(new Promise(() => {}));
    const loading = render(<PlanProposalReviewPage />);
    expect(screen.getByText("Loading Plan Proposals…")).toBeInTheDocument();
    loading.unmount();
    listPlanProposals.mockReset().mockRejectedValue(new Error("offline"));
    const failed = render(<PlanProposalReviewPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    failed.unmount();
    listPlanProposals.mockReset().mockResolvedValue([]);
    render(<PlanProposalReviewPage />);
    expect(await screen.findByText("No Plan Proposals awaiting review.")).toBeInTheDocument();
  });
});
