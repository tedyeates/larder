"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { createRecipe, deleteRecipe, listCookability, listRecipes } from "@/lib/recipes/recipes";
import type { Recipe, RecipeCookability } from "@/lib/recipes/types";

type LoadState = "loading" | "loaded" | "error";

/**
 * Recipes screen: the list of every Recipe, each showing whether it's
 * currently Cookable, with a form to create a new one. Editing, lines,
 * Substitutes, Inconsistencies and the reading view all live on the
 * per-Recipe detail screen (`/recipes/[id]`) — this list stays a single
 * flat scroll so it reads well on a phone.
 */
export default function RecipesPage() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [cookability, setCookability] = useState<Map<string, boolean>>(new Map());
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function refresh() {
    setLoadState("loading");
    setErrorMessage(null);
    try {
      const supabase = createClient();
      const [recipeRows, cookabilityRows] = await Promise.all([
        listRecipes(supabase),
        listCookability(supabase),
      ]);
      setRecipes(recipeRows);
      setCookability(new Map(cookabilityRows.map((row: RecipeCookability) => [row.recipeId, row.isCookable])));
      setLoadState("loaded");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load Recipes");
      setLoadState("error");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleCreate(input: { name: string; servings: number }) {
    const supabase = createClient();
    await createRecipe(supabase, input);
    await refresh();
  }

  async function handleDelete(id: string) {
    const supabase = createClient();
    await deleteRecipe(supabase, id);
    await refresh();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Recipes</h1>
        <p className="mt-2 text-sm text-foreground/60">
          Lines measure in each Ingredient&apos;s Stock Unit, so shopping and depletion arithmetic
          is exact.
        </p>
      </div>

      <CreateRecipeForm onCreate={handleCreate} />

      {loadState === "loading" ? (
        <p className="text-sm text-foreground/60">Loading…</p>
      ) : loadState === "error" ? (
        <p role="alert" className="text-sm text-red-600">
          {errorMessage}
        </p>
      ) : recipes.length === 0 ? (
        <p data-testid="recipes-empty" className="text-sm text-foreground/60">
          No Recipes yet. Add one above.
        </p>
      ) : (
        <ul className="divide-y divide-foreground/10">
          {recipes.map((recipe) => (
            <RecipeRow
              key={recipe.id}
              recipe={recipe}
              isCookable={cookability.get(recipe.id) ?? null}
              onDelete={() => handleDelete(recipe.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function CreateRecipeForm({
  onCreate,
}: {
  onCreate: (input: { name: string; servings: number }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [servings, setServings] = useState("4");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onCreate({ name, servings: Number(servings) });
      setName("");
      setServings("4");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to create Recipe");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-2 rounded-md border border-foreground/10 p-4 sm:flex-row sm:items-end"
    >
      <div className="flex-1 space-y-1">
        <label htmlFor="recipe-name" className="text-xs font-medium text-foreground/60">
          Name
        </label>
        <input
          id="recipe-name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Chicken Stir-fry"
          className="w-full rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/50"
        />
      </div>
      <div className="w-full space-y-1 sm:w-24">
        <label htmlFor="recipe-servings" className="text-xs font-medium text-foreground/60">
          Servings
        </label>
        <input
          id="recipe-servings"
          required
          type="number"
          min="1"
          step="1"
          value={servings}
          onChange={(event) => setServings(event.target.value)}
          className="w-full rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/50"
        />
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-50"
      >
        {submitting ? "Adding…" : "Add Recipe"}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-red-600 sm:basis-full">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function RecipeRow({
  recipe,
  isCookable,
  onDelete,
}: {
  recipe: Recipe;
  isCookable: boolean | null;
  onDelete: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDeleteClick() {
    if (!window.confirm(`Delete ${recipe.name}? This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete");
      setBusy(false);
    }
  }

  return (
    <li className="py-3">
      <div className="flex items-center justify-between gap-2">
        <Link href={`/recipes/${recipe.id}`} className="flex-1">
          <span className="font-medium">{recipe.name}</span>
          <span className="ml-2 text-sm text-foreground/60">
            {recipe.servings} serving{recipe.servings === 1 ? "" : "s"}
          </span>
          {recipe.rating ? (
            <span className="ml-2 text-sm text-foreground/60" aria-label={`Rated ${recipe.rating} out of 5`}>
              {"★".repeat(recipe.rating)}
              {"☆".repeat(5 - recipe.rating)}
            </span>
          ) : null}
          {isCookable === true ? (
            <span className="ml-2 rounded-full bg-green-600/10 px-2 py-0.5 text-xs font-medium text-green-700">
              Cookable
            </span>
          ) : isCookable === false ? (
            <span className="ml-2 rounded-full bg-foreground/10 px-2 py-0.5 text-xs text-foreground/60">
              Not Cookable
            </span>
          ) : null}
        </Link>
        <button
          type="button"
          onClick={handleDeleteClick}
          disabled={busy}
          className="rounded-md border border-foreground/20 px-2 py-1 text-xs text-red-600 disabled:opacity-50"
        >
          Delete
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-1 text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </li>
  );
}
