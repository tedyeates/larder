import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ResolutionQueuePage from "./page";

const select = vi.fn();
const from = vi.fn(() => ({ select }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ from }) }));

const listIngredients = vi.fn();
vi.mock("@/lib/ingredients/registry", () => ({
  listIngredients: (...args: unknown[]) => listIngredients(...args),
}));

const resolveLine = vi.fn();
vi.mock("@/lib/recipes/recipes", () => ({
  resolveLine: (...args: unknown[]) => resolveLine(...args),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

const queue = [
  {
    recipe_line_id: "line-leak",
    recipe_id: "recipe-soup",
    recipe_name: "Spring soup",
    recipe_status: "draft",
    reason: "unresolved_ingredient",
    line_label: "Leak",
  },
  {
    recipe_line_id: "line-handful",
    recipe_id: "recipe-stir-fry",
    recipe_name: "Stir-fry",
    recipe_status: "draft",
    reason: "non_convertible_unit",
    line_label: "Beansprouts",
  },
];

describe("ResolutionQueuePage", () => {
  beforeEach(() => {
    from.mockClear();
    select.mockReset().mockReturnValue({ order: vi.fn().mockResolvedValue({ data: queue, error: null }) });
    listIngredients.mockReset().mockResolvedValue([
      { id: "leek", name: "Leek", stockUnit: "pieces", isHandDepleted: false, lastPurchasedAmount: null, status: "active", createdAt: "2026-01-01" },
    ]);
    resolveLine.mockReset().mockResolvedValue(undefined);
  });

  it("renders every outstanding inconsistency and its Draft Recipe", async () => {
    render(<ResolutionQueuePage />);

    expect(await screen.findByText("Leak")).toBeInTheDocument();
    expect(screen.getByText("Spring soup")).toBeInTheDocument();
    expect(screen.getAllByText("Draft")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Fix unit" })).toHaveAttribute("href", "/recipes/recipe-stir-fry");
  });

  it("confirms an unresolved name mapping, then reloads the queue", async () => {
    render(<ResolutionQueuePage />);
    await screen.findByText("Leak");

    fireEvent.change(screen.getByLabelText("Map Leak to Ingredient"), { target: { value: "leek" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm mapping" }));

    await waitFor(() =>
      expect(resolveLine).toHaveBeenCalledWith(expect.anything(), "line-leak", "leek", true)
    );
    expect(select).toHaveBeenCalledTimes(2);
  });

  it("shows empty and error states", async () => {
    select.mockReset().mockReturnValue({ order: vi.fn().mockResolvedValue({ data: [], error: null }) });
    const { unmount } = render(<ResolutionQueuePage />);
    expect(await screen.findByText("No Recipe Inconsistencies. Your Recipes are ready for planning.")).toBeInTheDocument();
    unmount();

    select.mockReset().mockReturnValue({ order: vi.fn().mockResolvedValue({ data: null, error: { message: "network down" } }) });
    render(<ResolutionQueuePage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("network down");
  });
});
