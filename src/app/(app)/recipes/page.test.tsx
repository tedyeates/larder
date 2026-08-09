import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import RecipesPage from "./page";
import type { Recipe, RecipeCookability } from "@/lib/recipes/types";

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

const listRecipes = vi.fn();
const listCookability = vi.fn();
const createRecipe = vi.fn();
const deleteRecipe = vi.fn();

vi.mock("@/lib/recipes/recipes", () => ({
  listRecipes: (...args: unknown[]) => listRecipes(...args),
  listCookability: (...args: unknown[]) => listCookability(...args),
  createRecipe: (...args: unknown[]) => createRecipe(...args),
  deleteRecipe: (...args: unknown[]) => deleteRecipe(...args),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const stirFry: Recipe = {
  id: "r1",
  name: "Chicken Stir-fry",
  servings: 4,
  maxMultiplier: 3,
  rating: 4,
  prepMinutes: 10,
  cookMinutes: 15,
  source: "family recipe",
  steps: null,
  createdAt: "2026-01-01T00:00:00Z",
};

const sushi: Recipe = {
  id: "r2",
  name: "Sushi",
  servings: 2,
  maxMultiplier: 1,
  rating: null,
  prepMinutes: null,
  cookMinutes: null,
  source: null,
  steps: null,
  createdAt: "2026-01-01T00:00:00Z",
};

describe("RecipesPage", () => {
  beforeEach(() => {
    listRecipes.mockReset().mockResolvedValue([stirFry, sushi]);
    listCookability.mockReset().mockResolvedValue([
      { recipeId: "r1", name: "Chicken Stir-fry", isCookable: true } satisfies RecipeCookability,
      { recipeId: "r2", name: "Sushi", isCookable: false } satisfies RecipeCookability,
    ]);
    createRecipe.mockReset().mockResolvedValue(stirFry);
    deleteRecipe.mockReset().mockResolvedValue(undefined);
  });

  it("renders without crashing and lists Recipes once loaded", async () => {
    render(<RecipesPage />);
    expect(await screen.findByText("Chicken Stir-fry")).toBeInTheDocument();
    expect(screen.getByText("Sushi")).toBeInTheDocument();
  });

  it("shows Cookable / Not Cookable badges from recipe_cookability", async () => {
    render(<RecipesPage />);
    await screen.findByText("Chicken Stir-fry");
    expect(screen.getByText("Cookable")).toBeInTheDocument();
    expect(screen.getByText("Not Cookable")).toBeInTheDocument();
  });

  it("shows the rating as stars when rated", async () => {
    render(<RecipesPage />);
    await screen.findByText("Chicken Stir-fry");
    expect(screen.getByLabelText("Rated 4 out of 5")).toBeInTheDocument();
  });

  it("shows an empty state when there are no Recipes", async () => {
    listRecipes.mockReset().mockResolvedValue([]);
    listCookability.mockReset().mockResolvedValue([]);
    render(<RecipesPage />);
    expect(await screen.findByTestId("recipes-empty")).toBeInTheDocument();
  });

  it("shows an error state when loading fails", async () => {
    listRecipes.mockReset().mockRejectedValue(new Error("network down"));
    render(<RecipesPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("network down");
  });

  it("creates a Recipe from the form and refreshes the list", async () => {
    render(<RecipesPage />);
    await screen.findByText("Chicken Stir-fry");

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Tacos" } });
    fireEvent.change(screen.getByLabelText("Servings"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Recipe" }));

    await waitFor(() =>
      expect(createRecipe).toHaveBeenCalledWith({}, { name: "Tacos", servings: 3 })
    );
    expect(listRecipes).toHaveBeenCalledTimes(2);
  });

  it("deletes a Recipe after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<RecipesPage />);
    await screen.findByText("Chicken Stir-fry");

    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);

    await waitFor(() => expect(deleteRecipe).toHaveBeenCalledWith({}, "r1"));
  });

  it("does not delete when the confirmation is dismissed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<RecipesPage />);
    await screen.findByText("Chicken Stir-fry");

    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);

    await waitFor(() => expect(deleteRecipe).not.toHaveBeenCalled());
  });
});
