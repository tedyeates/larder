"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  addLine,
  addSubstitute,
  addTag,
  allergenFlagsFromTags,
  getRecipeWithLines,
  listInconsistencies,
  listLineStatuses,
  rateRecipe,
  removeLine,
  removeSubstitute,
  removeTag,
  reorderLines,
  resolveLine,
  updateLine,
  updateRecipe,
} from "@/lib/recipes/recipes";
import { createIngredient, listIngredients, resolveIngredientName } from "@/lib/ingredients/registry";
import type { Ingredient, IngredientCandidate } from "@/lib/ingredients/types";
import {
  INCONSISTENCY_REASON_LABELS,
  type RecipeInconsistency,
  type RecipeLinePantryStatus,
  type RecipeLineStatus,
  type RecipeLineWithDetails,
  type RecipeWithLines,
} from "@/lib/recipes/types";

type LoadState = "loading" | "loaded" | "error";
type ViewMode = "read" | "edit";

/**
 * Recipe detail screen: toggles between a Reading view (pleasant on a
 * phone at the hob — steps, amounts, per-line Pantry status) and an
 * Editing view (add/reorder/remove Lines, Substitutes, Essential,
 * Inconsistencies, resolution). Both read from the same
 * `getRecipeWithLines` grouped read so they never disagree.
 */
export default function RecipeDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const recipeId = params.id;

  const [recipe, setRecipe] = useState<RecipeWithLines | null>(null);
  const [inconsistencies, setInconsistencies] = useState<RecipeInconsistency[]>([]);
  const [lineStatuses, setLineStatuses] = useState<Map<string, RecipeLineStatus>>(new Map());
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>("read");

  async function refresh() {
    setLoadState("loading");
    setErrorMessage(null);
    try {
      const supabase = createClient();
      const [recipeRow, inconsistencyRows, statusRows, ingredientRows] = await Promise.all([
        getRecipeWithLines(supabase, recipeId),
        listInconsistencies(supabase, recipeId),
        listLineStatuses(supabase, recipeId),
        listIngredients(supabase),
      ]);
      setRecipe(recipeRow);
      setInconsistencies(inconsistencyRows);
      setLineStatuses(new Map(statusRows.map((row: RecipeLinePantryStatus) => [row.recipeLineId, row.status])));
      setIngredients(ingredientRows);
      setLoadState("loaded");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load Recipe");
      setLoadState("error");
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipeId]);

  if (loadState === "loading") {
    return <p className="text-sm text-foreground/60">Loading…</p>;
  }

  if (loadState === "error") {
    return (
      <p role="alert" className="text-sm text-red-600">
        {errorMessage}
      </p>
    );
  }

  if (!recipe) {
    return <p className="text-sm text-foreground/60">Recipe not found.</p>;
  }

  const isCookable = !recipe.lines.some(
    (line) => lineStatuses.get(line.id) === "missing"
  );
  const allergenFlags = allergenFlagsFromTags(recipe.tags);

  return (
    <div className="space-y-6 pb-16">
      <div className="flex items-start justify-between gap-2">
        <div>
          <button
            type="button"
            onClick={() => router.push("/recipes")}
            className="text-sm text-foreground/60"
          >
            ← Recipes
          </button>
          <h1 className="mt-1 text-xl font-semibold">{recipe.name}</h1>
        </div>
        <div className="flex gap-2 text-sm">
          <button
            type="button"
            onClick={() => setMode("read")}
            aria-pressed={mode === "read"}
            className={`rounded-md border px-3 py-1.5 ${mode === "read" ? "border-foreground bg-foreground text-background" : "border-foreground/20"}`}
          >
            Read
          </button>
          <button
            type="button"
            onClick={() => setMode("edit")}
            aria-pressed={mode === "edit"}
            className={`rounded-md border px-3 py-1.5 ${mode === "edit" ? "border-foreground bg-foreground text-background" : "border-foreground/20"}`}
          >
            Edit
          </button>
        </div>
      </div>

      <RecipeSummary
        recipe={recipe}
        isCookable={isCookable}
        allergenFlags={allergenFlags}
        onRate={async (rating) => {
          const supabase = createClient();
          await rateRecipe(supabase, recipe.id, rating);
          await refresh();
        }}
      />

      {inconsistencies.length > 0 ? (
        <InconsistencyList inconsistencies={inconsistencies} />
      ) : null}

      {mode === "read" ? (
        <ReadingView recipe={recipe} lineStatuses={lineStatuses} />
      ) : (
        <EditingView
          recipe={recipe}
          ingredients={ingredients}
          onChanged={refresh}
        />
      )}
    </div>
  );
}

function RecipeSummary({
  recipe,
  isCookable,
  allergenFlags,
  onRate,
}: {
  recipe: RecipeWithLines;
  isCookable: boolean;
  allergenFlags: string[];
  onRate: (rating: number) => Promise<void>;
}) {
  return (
    <div className="space-y-2 rounded-md border border-foreground/10 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span>{recipe.servings} servings</span>
        {recipe.prepMinutes !== null ? <span>· {recipe.prepMinutes} min prep</span> : null}
        {recipe.cookMinutes !== null ? <span>· {recipe.cookMinutes} min cook</span> : null}
        {recipe.source ? <span>· {recipe.source}</span> : null}
        {isCookable ? (
          <span className="rounded-full bg-green-600/10 px-2 py-0.5 text-xs font-medium text-green-700">
            Cookable
          </span>
        ) : (
          <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-xs text-foreground/60">
            Not Cookable
          </span>
        )}
      </div>

      <StarRating rating={recipe.rating} onRate={onRate} />

      {recipe.tags.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {recipe.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-foreground/20 px-2 py-0.5 text-xs text-foreground/60"
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      {allergenFlags.length > 0 ? (
        <p role="alert" className="text-xs text-amber-700">
          Allergen Flags: {allergenFlags.join(", ")}
        </p>
      ) : null}
    </div>
  );
}

function StarRating({
  rating,
  onRate,
}: {
  rating: number | null;
  onRate: (rating: number) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick(value: number) {
    setBusy(true);
    setError(null);
    try {
      await onRate(value);
    } catch (rateError) {
      setError(rateError instanceof Error ? rateError.message : "Failed to rate");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-1" role="group" aria-label="Rate this Recipe">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            disabled={busy}
            onClick={() => handleClick(value)}
            aria-label={`Rate ${value} out of 5`}
            aria-pressed={rating === value}
            className="text-lg leading-none disabled:opacity-50"
          >
            {rating !== null && value <= rating ? "★" : "☆"}
          </button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function InconsistencyList({ inconsistencies }: { inconsistencies: RecipeInconsistency[] }) {
  return (
    <div
      data-testid="inconsistencies"
      className="space-y-1 rounded-md border border-amber-600/30 bg-amber-600/5 p-4 text-sm"
    >
      <h2 className="font-semibold text-amber-800">Inconsistencies</h2>
      <ul className="space-y-1">
        {inconsistencies.map((inconsistency) => (
          <li key={inconsistency.recipeLineId} className="text-amber-800">
            <span className="font-medium">{inconsistency.lineLabel}</span>:{" "}
            {INCONSISTENCY_REASON_LABELS[inconsistency.reason]}
          </li>
        ))}
      </ul>
    </div>
  );
}

const STATUS_LABELS: Record<RecipeLineStatus, string> = {
  available: "In stock",
  fulfilled_by_substitute: "Fulfilled by Substitute",
  missing: "Missing",
};

const STATUS_STYLES: Record<RecipeLineStatus, string> = {
  available: "bg-green-600/10 text-green-700",
  fulfilled_by_substitute: "bg-amber-600/10 text-amber-700",
  missing: "bg-red-600/10 text-red-700",
};

function ReadingView({
  recipe,
  lineStatuses,
}: {
  recipe: RecipeWithLines;
  lineStatuses: Map<string, RecipeLineStatus>;
}) {
  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-sm font-semibold text-foreground/60">Ingredients</h2>
        <ul className="mt-2 space-y-2">
          {recipe.lines.map((line) => {
            const status = lineStatuses.get(line.id);
            return (
              <li key={line.id} className="flex items-start justify-between gap-2 text-base">
                <span>
                  {line.amount !== null ? (
                    <span className="font-medium">
                      {line.amount} {line.unit}
                    </span>
                  ) : null}{" "}
                  {line.ingredientName ?? line.rawName}
                  {line.note ? <span className="text-foreground/60"> ({line.note})</span> : null}
                  {line.isEssential ? (
                    <span className="ml-1 text-xs text-foreground/60">Essential</span>
                  ) : null}
                </span>
                {status ? (
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
                  >
                    {STATUS_LABELS[status]}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      {recipe.steps ? (
        <section>
          <h2 className="text-sm font-semibold text-foreground/60">Steps</h2>
          <p className="mt-2 whitespace-pre-wrap text-base leading-relaxed">{recipe.steps}</p>
        </section>
      ) : null}
    </div>
  );
}

function EditingView({
  recipe,
  ingredients,
  onChanged,
}: {
  recipe: RecipeWithLines;
  ingredients: Ingredient[];
  onChanged: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [savingDetails, setSavingDetails] = useState(false);
  const [name, setName] = useState(recipe.name);
  const [servings, setServings] = useState(String(recipe.servings));
  const [maxMultiplier, setMaxMultiplier] = useState(String(recipe.maxMultiplier));
  const [prepMinutes, setPrepMinutes] = useState(recipe.prepMinutes?.toString() ?? "");
  const [cookMinutes, setCookMinutes] = useState(recipe.cookMinutes?.toString() ?? "");
  const [source, setSource] = useState(recipe.source ?? "");
  const [steps, setSteps] = useState(recipe.steps ?? "");
  const [tagDraft, setTagDraft] = useState("");

  async function handleSaveDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingDetails(true);
    setError(null);
    try {
      const supabase = createClient();
      await updateRecipe(supabase, recipe.id, {
        name,
        servings: Number(servings),
        maxMultiplier: Number(maxMultiplier),
        prepMinutes: prepMinutes === "" ? null : Number(prepMinutes),
        cookMinutes: cookMinutes === "" ? null : Number(cookMinutes),
        source: source === "" ? null : source,
        steps: steps === "" ? null : steps,
      });
      await onChanged();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save Recipe");
    } finally {
      setSavingDetails(false);
    }
  }

  async function handleAddTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (tagDraft.trim() === "") return;
    try {
      const supabase = createClient();
      await addTag(supabase, recipe.id, tagDraft.trim());
      setTagDraft("");
      await onChanged();
    } catch (tagError) {
      setError(tagError instanceof Error ? tagError.message : "Failed to add Tag");
    }
  }

  async function handleRemoveTag(tag: string) {
    try {
      const supabase = createClient();
      await removeTag(supabase, recipe.id, tag);
      await onChanged();
    } catch (tagError) {
      setError(tagError instanceof Error ? tagError.message : "Failed to remove Tag");
    }
  }

  async function handleReorder(lineId: string, direction: "up" | "down") {
    const ordered = [...recipe.lines].sort((a, b) => a.position - b.position);
    const index = ordered.findIndex((line) => line.id === lineId);
    const target = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= ordered.length) return;

    const reordered = [...ordered];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];

    try {
      const supabase = createClient();
      await reorderLines(supabase, recipe.id, reordered.map((line) => line.id));
      await onChanged();
    } catch (reorderError) {
      setError(reorderError instanceof Error ? reorderError.message : "Failed to reorder");
    }
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={handleSaveDetails}
        className="grid gap-3 rounded-md border border-foreground/10 p-4 sm:grid-cols-2"
      >
        <Field label="Name" htmlFor="edit-name">
          <input
            id="edit-name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="w-full rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/50"
          />
        </Field>
        <Field label="Servings" htmlFor="edit-servings">
          <input
            id="edit-servings"
            required
            type="number"
            min="1"
            value={servings}
            onChange={(event) => setServings(event.target.value)}
            className="w-full rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/50"
          />
        </Field>
        <Field label="Max multiplier" htmlFor="edit-max-multiplier">
          <input
            id="edit-max-multiplier"
            required
            type="number"
            min="1"
            value={maxMultiplier}
            onChange={(event) => setMaxMultiplier(event.target.value)}
            className="w-full rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/50"
          />
        </Field>
        <Field label="Prep minutes" htmlFor="edit-prep-minutes">
          <input
            id="edit-prep-minutes"
            type="number"
            min="0"
            value={prepMinutes}
            onChange={(event) => setPrepMinutes(event.target.value)}
            className="w-full rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/50"
          />
        </Field>
        <Field label="Cook minutes" htmlFor="edit-cook-minutes">
          <input
            id="edit-cook-minutes"
            type="number"
            min="0"
            value={cookMinutes}
            onChange={(event) => setCookMinutes(event.target.value)}
            className="w-full rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/50"
          />
        </Field>
        <Field label="Source" htmlFor="edit-source">
          <input
            id="edit-source"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            className="w-full rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/50"
          />
        </Field>
        <Field label="Steps" htmlFor="edit-steps" className="sm:col-span-2">
          <textarea
            id="edit-steps"
            rows={6}
            value={steps}
            onChange={(event) => setSteps(event.target.value)}
            className="w-full rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/50"
          />
        </Field>
        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={savingDetails}
            className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-50"
          >
            {savingDetails ? "Saving…" : "Save details"}
          </button>
        </div>
      </form>

      <div className="rounded-md border border-foreground/10 p-4">
        <h2 className="text-sm font-semibold">Tags</h2>
        <div className="mt-2 flex flex-wrap gap-1">
          {recipe.tags.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-1 rounded-full border border-foreground/20 px-2 py-0.5 text-xs"
            >
              {tag}
              <button type="button" onClick={() => handleRemoveTag(tag)} aria-label={`Remove tag ${tag}`}>
                ×
              </button>
            </span>
          ))}
        </div>
        <form onSubmit={handleAddTag} className="mt-2 flex items-center gap-2">
          <label htmlFor="tag-draft" className="sr-only">
            New tag
          </label>
          <input
            id="tag-draft"
            value={tagDraft}
            onChange={(event) => setTagDraft(event.target.value)}
            placeholder="dairy"
            className="w-full rounded-md border border-foreground/20 bg-transparent px-2 py-1 text-sm outline-none focus:border-foreground/50"
          />
          <button type="submit" className="rounded-md border border-foreground/20 px-2 py-1 text-xs">
            Add
          </button>
        </form>
      </div>

      <div className="rounded-md border border-foreground/10 p-4">
        <h2 className="text-sm font-semibold">Lines</h2>
        <ul className="mt-2 divide-y divide-foreground/10">
          {recipe.lines
            .slice()
            .sort((a, b) => a.position - b.position)
            .map((line, index) => (
              <RecipeLineEditor
                key={line.id}
                line={line}
                ingredients={ingredients}
                canMoveUp={index > 0}
                canMoveDown={index < recipe.lines.length - 1}
                onMoveUp={() => handleReorder(line.id, "up")}
                onMoveDown={() => handleReorder(line.id, "down")}
                onChanged={onChanged}
              />
            ))}
        </ul>
        <AddLineForm recipeId={recipe.id} ingredients={ingredients} onChanged={onChanged} />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1 ${className ?? ""}`}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-foreground/60">
        {label}
      </label>
      {children}
    </div>
  );
}

function AddLineForm({
  recipeId,
  ingredients,
  onChanged,
}: {
  recipeId: string;
  ingredients: Ingredient[];
  onChanged: () => Promise<void>;
}) {
  const [ingredientId, setIngredientId] = useState("");
  const [rawName, setRawName] = useState("");
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState("");
  const [note, setNote] = useState("");
  const [isEssential, setIsEssential] = useState(false);
  const [noQuantity, setNoQuantity] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const statedAmount = noQuantity ? "" : amount.trim();
    const statedUnit = noQuantity ? "" : unit.trim();

    // A line carries an amount and a unit together or neither — never a
    // bare number, which would be an amount in no stated unit at all.
    if ((statedAmount === "") !== (statedUnit === "")) {
      setError("State both an amount and a unit, or tick “No quantity”.");
      return;
    }

    if (ingredientId === "" && rawName.trim() === "") {
      setError("Choose an Ingredient, or type the name as written.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      await addLine(supabase, {
        recipeId,
        ingredientId: ingredientId === "" ? null : ingredientId,
        rawName: ingredientId === "" ? rawName.trim() : null,
        amount: statedAmount === "" ? null : Number(statedAmount),
        unit: statedUnit === "" ? null : statedUnit,
        note: note.trim() === "" ? null : note.trim(),
        isEssential,
      });
      setIngredientId("");
      setRawName("");
      setAmount("");
      setUnit("");
      setNote("");
      setIsEssential(false);
      setNoQuantity(false);
      await onChanged();
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "Failed to add line");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 grid gap-2 border-t border-foreground/10 pt-3 sm:grid-cols-2">
      <Field label="Ingredient" htmlFor="line-ingredient">
        <select
          id="line-ingredient"
          value={ingredientId}
          onChange={(event) => setIngredientId(event.target.value)}
          className="w-full rounded-md border border-foreground/20 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-foreground/50"
        >
          <option value="">Not matched yet (type a name)</option>
          {ingredients.map((ingredient) => (
            <option key={ingredient.id} value={ingredient.id}>
              {ingredient.name} ({ingredient.stockUnit})
            </option>
          ))}
        </select>
      </Field>
      {ingredientId === "" ? (
        <Field label="Name as written" htmlFor="line-raw-name">
          <input
            id="line-raw-name"
            value={rawName}
            onChange={(event) => setRawName(event.target.value)}
            placeholder="Leak"
            className="w-full rounded-md border border-foreground/20 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-foreground/50"
          />
        </Field>
      ) : (
        <div />
      )}
      <Field label="Amount" htmlFor="line-amount">
        <input
          id="line-amount"
          type="number"
          step="any"
          min="0"
          disabled={noQuantity}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          className="w-full rounded-md border border-foreground/20 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-foreground/50 disabled:opacity-50"
        />
      </Field>
      <Field label="Unit" htmlFor="line-unit">
        <input
          id="line-unit"
          disabled={noQuantity}
          value={unit}
          onChange={(event) => setUnit(event.target.value)}
          placeholder="pieces, cup, g…"
          className="w-full rounded-md border border-foreground/20 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-foreground/50 disabled:opacity-50"
        />
      </Field>
      <Field label="Note" htmlFor="line-note" className="sm:col-span-2">
        <input
          id="line-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="≈ half a bag"
          className="w-full rounded-md border border-foreground/20 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-foreground/50"
        />
      </Field>
      <div className="flex items-center gap-4 text-sm sm:col-span-2">
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={noQuantity}
            onChange={(event) => setNoQuantity(event.target.checked)}
          />
          No quantity (Hand-Depleted only)
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={isEssential}
            onChange={(event) => setIsEssential(event.target.checked)}
          />
          Essential
        </label>
      </div>
      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md border border-foreground/20 px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {busy ? "Adding…" : "Add line"}
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-red-600 sm:col-span-2">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function RecipeLineEditor({
  line,
  ingredients,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onChanged,
}: {
  line: RecipeLineWithDetails;
  ingredients: Ingredient[];
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => Promise<void>;
  onMoveDown: () => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showResolve, setShowResolve] = useState(false);
  const [showSubstitutes, setShowSubstitutes] = useState(false);

  async function handleDelete() {
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      await removeLine(supabase, line.id);
      await onChanged();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete line");
      setBusy(false);
    }
  }

  async function handleToggleEssential() {
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      await updateLine(supabase, line.id, {
        ingredientId: line.ingredientId,
        rawName: line.rawName,
        amount: line.amount,
        unit: line.unit,
        note: line.note,
        isEssential: !line.isEssential,
      });
      await onChanged();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "Failed to update");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <p className="text-sm">
            {line.amount !== null ? (
              <span className="font-medium">
                {line.amount} {line.unit}
              </span>
            ) : (
              <span className="text-foreground/60">no quantity</span>
            )}{" "}
            {line.ingredientName ?? (
              <span>
                <span className="text-amber-700">{line.rawName}</span>{" "}
                <span className="text-xs text-amber-700">(unresolved)</span>
              </span>
            )}
            {line.note ? <span className="text-foreground/60"> ({line.note})</span> : null}
          </p>
        </div>
        <div className="flex items-center gap-1 text-xs">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={busy || !canMoveUp}
            aria-label="Move line up"
            className="rounded-md border border-foreground/20 px-2 py-1 disabled:opacity-30"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={busy || !canMoveDown}
            aria-label="Move line down"
            className="rounded-md border border-foreground/20 px-2 py-1 disabled:opacity-30"
          >
            ↓
          </button>
          {line.ingredientId === null ? (
            <button
              type="button"
              onClick={() => setShowResolve(!showResolve)}
              className="rounded-md border border-foreground/20 px-2 py-1"
            >
              Resolve
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setShowSubstitutes(!showSubstitutes)}
              className="rounded-md border border-foreground/20 px-2 py-1"
            >
              Substitutes
            </button>
          )}
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={line.isEssential} disabled={busy} onChange={handleToggleEssential} />
            Essential
          </label>
          <button
            type="button"
            onClick={handleDelete}
            disabled={busy}
            className="rounded-md border border-foreground/20 px-2 py-1 text-red-600 disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-1 text-sm text-red-600">
          {error}
        </p>
      ) : null}

      {showResolve ? (
        <ResolveLineForm line={line} onChanged={onChanged} onDone={() => setShowResolve(false)} />
      ) : null}

      {showSubstitutes && line.ingredientId !== null ? (
        <SubstituteManager line={line} ingredients={ingredients} onChanged={onChanged} />
      ) : null}
    </li>
  );
}

function ResolveLineForm({
  line,
  onChanged,
  onDone,
}: {
  line: RecipeLineWithDetails;
  onChanged: () => Promise<void>;
  onDone: () => void;
}) {
  const [candidates, setCandidates] = useState<IngredientCandidate[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState(line.rawName ?? "");
  const [newStockUnit, setNewStockUnit] = useState(line.unit ?? "");
  const [newIsHandDepleted, setNewIsHandDepleted] = useState(false);

  useEffect(() => {
    async function search() {
      setState("loading");
      try {
        const supabase = createClient();
        const result = await resolveIngredientName(supabase, line.rawName ?? "");
        // An exact or Alias hit is the strongest candidate there is — offer
        // it rather than falling through to "no close matches", which is
        // how the same free text would get asked about twice.
        setCandidates(
          result.resolved
            ? [
                {
                  ingredientId: result.ingredientId,
                  name: result.name,
                  matchKind: result.matchKind,
                  score: 1,
                },
              ]
            : result.candidates
        );
        setState("loaded");
      } catch (searchError) {
        setError(searchError instanceof Error ? searchError.message : "Failed to search Ingredients");
        setState("error");
      }
    }
    search();
  }, [line.rawName]);

  async function handleResolve(ingredientId: string) {
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      await resolveLine(supabase, line.id, ingredientId, true);
      onDone();
      await onChanged();
    } catch (resolveError) {
      setError(resolveError instanceof Error ? resolveError.message : "Failed to resolve line");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateAndResolve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newName.trim() === "" || newStockUnit.trim() === "") {
      setError("A new Ingredient needs a name and a Stock Unit.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const created = await createIngredient(supabase, {
        name: newName.trim(),
        stockUnit: newStockUnit.trim(),
        isHandDepleted: newIsHandDepleted,
      });
      await resolveLine(supabase, line.id, created.id, true);
      onDone();
      await onChanged();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create Ingredient");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 rounded-md bg-foreground/5 p-3 text-sm">
      <p className="text-xs text-foreground/60">
        Map &quot;{line.rawName}&quot; to an existing Ingredient — remembered as an Alias so it&apos;s
        never asked again — or create a new Ingredient for it.
      </p>
      {state === "loading" ? (
        <p className="mt-2 text-xs text-foreground/60">Searching…</p>
      ) : state === "error" ? (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {error}
        </p>
      ) : candidates.length === 0 ? (
        <p className="mt-2 text-xs text-foreground/60">No close matches.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {candidates.map((candidate) => (
            <li key={candidate.ingredientId}>
              <button
                type="button"
                disabled={busy}
                onClick={() => handleResolve(candidate.ingredientId)}
                className="rounded-md border border-foreground/20 px-2 py-1 text-xs disabled:opacity-50"
              >
                {candidate.name} ({Math.round(candidate.score * 100)}%)
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleCreateAndResolve} className="mt-3 grid gap-2 border-t border-foreground/10 pt-3">
        <Field label="New Ingredient name" htmlFor={`new-ingredient-name-${line.id}`}>
          <input
            id={`new-ingredient-name-${line.id}`}
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            className="w-full rounded-md border border-foreground/20 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-foreground/50"
          />
        </Field>
        <Field label="Stock Unit" htmlFor={`new-ingredient-unit-${line.id}`}>
          <input
            id={`new-ingredient-unit-${line.id}`}
            value={newStockUnit}
            onChange={(event) => setNewStockUnit(event.target.value)}
            placeholder="g, ml, pieces…"
            className="w-full rounded-md border border-foreground/20 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-foreground/50"
          />
        </Field>
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={newIsHandDepleted}
            onChange={(event) => setNewIsHandDepleted(event.target.checked)}
          />
          Hand-Depleted (adjusted by eye, may carry no quantity)
        </label>
        <div>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md border border-foreground/20 px-2 py-1 text-xs disabled:opacity-50"
          >
            Create Ingredient and use it
          </button>
        </div>
      </form>

      {error && state !== "error" ? (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function SubstituteManager({
  line,
  ingredients,
  onChanged,
}: {
  line: RecipeLineWithDetails;
  ingredients: Ingredient[];
  onChanged: () => Promise<void>;
}) {
  const [candidateId, setCandidateId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (candidateId === "") return;
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      await addSubstitute(supabase, line.id, candidateId);
      setCandidateId("");
      await onChanged();
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "Failed to add Substitute");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(id: string) {
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      await removeSubstitute(supabase, id);
      await onChanged();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Failed to remove Substitute");
    } finally {
      setBusy(false);
    }
  }

  if (line.isEssential) {
    return (
      <p className="mt-2 text-xs text-foreground/60">
        Essential lines never offer a Substitute — untick Essential to add one.
      </p>
    );
  }

  return (
    <div className="mt-2 rounded-md bg-foreground/5 p-3 text-sm">
      <h3 className="text-xs font-semibold text-foreground/60">
        Substitutes acceptable for this Recipe only
      </h3>
      <ul className="mt-1 space-y-1">
        {line.substitutes.length === 0 ? (
          <li className="text-xs text-foreground/60">None yet.</li>
        ) : (
          line.substitutes.map((substitute) => (
            <li key={substitute.id} className="flex items-center justify-between text-xs">
              <span>{substitute.ingredientName}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => handleRemove(substitute.id)}
                className="text-red-600 disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))
        )}
      </ul>
      <form onSubmit={handleAdd} className="mt-2 flex items-center gap-2">
        <label htmlFor={`substitute-${line.id}`} className="sr-only">
          Add a Substitute
        </label>
        <select
          id={`substitute-${line.id}`}
          value={candidateId}
          onChange={(event) => setCandidateId(event.target.value)}
          className="w-full rounded-md border border-foreground/20 bg-transparent px-2 py-1 text-xs outline-none focus:border-foreground/50"
        >
          <option value="">Choose an Ingredient…</option>
          {ingredients
            .filter((ingredient) => ingredient.id !== line.ingredientId)
            .map((ingredient) => (
              <option key={ingredient.id} value={ingredient.id}>
                {ingredient.name}
              </option>
            ))}
        </select>
        <button type="submit" disabled={busy} className="rounded-md border border-foreground/20 px-2 py-1 text-xs disabled:opacity-50">
          Add
        </button>
      </form>
      {error ? (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
