"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { listIngredients } from "@/lib/ingredients/registry";
import { resolveLine } from "@/lib/recipes/recipes";
import type { InconsistencyReason } from "@/lib/recipes/types";
import type { Ingredient } from "@/lib/ingredients/types";

type LoadState = "loading" | "loaded" | "error";

type QueueRow = {
  recipe_line_id: string;
  recipe_id: string;
  recipe_name: string;
  recipe_status: "draft" | "confirmed";
  reason: InconsistencyReason;
  line_label: string;
};

const ACTION_LABEL: Record<Exclude<InconsistencyReason, "unresolved_ingredient">, string> = {
  non_convertible_unit: "Fix unit",
  missing_unit: "Fix unit",
  unmeasured_on_auto_depleted: "Add quantity",
};

/**
 * Phone-first inbox for every exact-arithmetic blocker. Name mappings are
 * confirmed inline; amount and unit changes use the existing Recipe editor,
 * which keeps one validation/write path for both desktop and mobile.
 */
export default function ResolutionQueuePage() {
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoadState("loading");
    setError(null);
    try {
      const client = createClient();
      const [queueResult, ingredientRows] = await Promise.all([
        client
          .from("recipe_resolution_queue")
          .select("recipe_line_id, recipe_id, recipe_name, recipe_status, reason, line_label")
          .order("recipe_name", { ascending: true }),
        listIngredients(client),
      ]);
      if (queueResult.error) throw new Error(queueResult.error.message);
      setRows((queueResult.data ?? []) as QueueRow[]);
      setIngredients(ingredientRows);
      setLoadState("loaded");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load Resolution Queue");
      setLoadState("error");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  if (loadState === "loading") return <p className="text-sm text-foreground/60">Loading…</p>;
  if (loadState === "error") return <p role="alert" className="text-sm text-red-600">{error}</p>;

  return (
    <div className="space-y-5 pb-16">
      <div>
        <Link href="/recipes" className="text-sm text-foreground/60">← Recipes</Link>
        <h1 className="mt-1 text-xl font-semibold">Resolution Queue</h1>
        <p className="mt-2 text-sm text-foreground/60">
          Clear every Inconsistency before selecting a Recipe into a Meal Plan.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-md border border-foreground/10 p-4 text-sm text-foreground/60">
          No Recipe Inconsistencies. Your Recipes are ready for planning.
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <ResolutionCard key={row.recipe_line_id} row={row} ingredients={ingredients} onResolved={refresh} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ResolutionCard({
  row,
  ingredients,
  onResolved,
}: {
  row: QueueRow;
  ingredients: Ingredient[];
  onResolved: () => Promise<void>;
}) {
  const [ingredientId, setIngredientId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmMapping() {
    if (!ingredientId) {
      setError("Choose an Ingredient before confirming the mapping.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await resolveLine(createClient(), row.recipe_line_id, ingredientId, true);
      await onResolved();
    } catch (resolveError) {
      setError(resolveError instanceof Error ? resolveError.message : "Failed to resolve Ingredient");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="space-y-2 rounded-md border border-foreground/10 p-4 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <Link href={`/recipes/${row.recipe_id}`} className="font-medium underline">{row.recipe_name}</Link>
          <span className="ml-2 rounded-full bg-amber-600/10 px-2 py-0.5 text-xs text-amber-800">
            {row.recipe_status === "draft" ? "Draft" : "Confirmed"}
          </span>
          <p className="mt-1">{row.line_label}</p>
        </div>
        <span className="text-xs text-foreground/60">{row.reason.replaceAll("_", " ")}</span>
      </div>
      {row.reason === "unresolved_ingredient" ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="flex-1">
            <span className="sr-only">Map {row.line_label} to Ingredient</span>
            <select
              aria-label={`Map ${row.line_label} to Ingredient`}
              value={ingredientId}
              onChange={(event) => setIngredientId(event.target.value)}
              className="w-full rounded-md border border-foreground/20 bg-transparent px-2 py-2"
            >
              <option value="">Choose Ingredient…</option>
              {ingredients.map((ingredient) => <option key={ingredient.id} value={ingredient.id}>{ingredient.name}</option>)}
            </select>
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={confirmMapping}
            className="rounded-md bg-foreground px-3 py-2 font-medium text-background disabled:opacity-50"
          >
            {busy ? "Mapping…" : "Confirm mapping"}
          </button>
        </div>
      ) : (
        <Link
          href={`/recipes/${row.recipe_id}`}
          className="inline-block rounded-md border border-foreground/20 px-3 py-2 font-medium"
        >
          {ACTION_LABEL[row.reason]}
        </Link>
      )}
      {error ? <p role="alert" className="text-red-600">{error}</p> : null}
    </li>
  );
}
