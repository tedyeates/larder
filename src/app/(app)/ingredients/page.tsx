"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  addAlias,
  addUnitConversion,
  createIngredient,
  deleteIngredient,
  listAliases,
  listIngredients,
  listUnitConversions,
  removeAlias,
  removeUnitConversion,
  setHandDepleted,
  updateIngredient,
} from "@/lib/ingredients/registry";
import type { Ingredient, IngredientAlias, UnitConversion } from "@/lib/ingredients/types";

type LoadState = "loading" | "loaded" | "error";

/**
 * Ingredient Registry screen: create/edit/delete Ingredients, manage their
 * Aliases and Convertible Unit factors, and flag Hand-Depleted. Every
 * other module depends on this data, so this is a CRUD workhorse rather
 * than anything clever — the interesting logic (resolution, conversion)
 * lives in Postgres and is exercised by pgTAP, not from here.
 */
export default function IngredientsPage() {
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function refresh() {
    setLoadState("loading");
    setErrorMessage(null);
    try {
      const supabase = createClient();
      const rows = await listIngredients(supabase);
      setIngredients(rows);
      setLoadState("loaded");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load Ingredients");
      setLoadState("error");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleCreate(input: { name: string; stockUnit: string }) {
    const supabase = createClient();
    await createIngredient(supabase, input);
    await refresh();
  }

  async function handleDelete(id: string) {
    const supabase = createClient();
    await deleteIngredient(supabase, id);
    if (expandedId === id) setExpandedId(null);
    await refresh();
  }

  async function handleRename(id: string, name: string) {
    const supabase = createClient();
    await updateIngredient(supabase, id, { name });
    await refresh();
  }

  async function handleToggleHandDepleted(id: string, next: boolean) {
    const supabase = createClient();
    await setHandDepleted(supabase, id, next);
    await refresh();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Ingredients</h1>
        <p className="mt-2 text-sm text-foreground/60">
          The canonical names, Stock Units and Aliases every Recipe and the Pantry resolve
          against.
        </p>
      </div>

      <CreateIngredientForm onCreate={handleCreate} />

      {loadState === "loading" ? (
        <p className="text-sm text-foreground/60">Loading…</p>
      ) : loadState === "error" ? (
        <p role="alert" className="text-sm text-red-600">
          {errorMessage}
        </p>
      ) : ingredients.length === 0 ? (
        <p data-testid="ingredients-empty" className="text-sm text-foreground/60">
          No Ingredients yet. Add one above.
        </p>
      ) : (
        <ul className="divide-y divide-foreground/10">
          {ingredients.map((ingredient) => (
            <IngredientRow
              key={ingredient.id}
              ingredient={ingredient}
              expanded={expandedId === ingredient.id}
              onToggleExpanded={() =>
                setExpandedId(expandedId === ingredient.id ? null : ingredient.id)
              }
              onRename={(name) => handleRename(ingredient.id, name)}
              onToggleHandDepleted={(next) => handleToggleHandDepleted(ingredient.id, next)}
              onDelete={() => handleDelete(ingredient.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function CreateIngredientForm({
  onCreate,
}: {
  onCreate: (input: { name: string; stockUnit: string }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [stockUnit, setStockUnit] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onCreate({ name, stockUnit });
      setName("");
      setStockUnit("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to create Ingredient");
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
        <label htmlFor="ingredient-name" className="text-xs font-medium text-foreground/60">
          Name
        </label>
        <input
          id="ingredient-name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Chicken thighs"
          className="w-full rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/50"
        />
      </div>
      <div className="flex-1 space-y-1">
        <label htmlFor="ingredient-stock-unit" className="text-xs font-medium text-foreground/60">
          Stock Unit
        </label>
        <input
          id="ingredient-stock-unit"
          required
          value={stockUnit}
          onChange={(event) => setStockUnit(event.target.value)}
          placeholder="pieces"
          className="w-full rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/50"
        />
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-50"
      >
        {submitting ? "Adding…" : "Add Ingredient"}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-red-600 sm:basis-full">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function IngredientRow({
  ingredient,
  expanded,
  onToggleExpanded,
  onRename,
  onToggleHandDepleted,
  onDelete,
}: {
  ingredient: Ingredient;
  expanded: boolean;
  onToggleExpanded: () => void;
  onRename: (name: string) => Promise<void>;
  onToggleHandDepleted: (next: boolean) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(ingredient.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRenameSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onRename(nameDraft);
      setEditingName(false);
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "Failed to rename");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggle() {
    setBusy(true);
    setError(null);
    try {
      await onToggleHandDepleted(!ingredient.isHandDepleted);
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "Failed to update");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteClick() {
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
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex-1">
          {editingName ? (
            <form onSubmit={handleRenameSubmit} className="flex items-center gap-2">
              <label htmlFor={`rename-${ingredient.id}`} className="sr-only">
                Name for {ingredient.name}
              </label>
              <input
                id={`rename-${ingredient.id}`}
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                className="w-full rounded-md border border-foreground/20 bg-transparent px-2 py-1 text-sm outline-none focus:border-foreground/50"
              />
              <button
                type="submit"
                disabled={busy}
                className="rounded-md border border-foreground/20 px-2 py-1 text-xs"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingName(false);
                  setNameDraft(ingredient.name);
                }}
                className="rounded-md border border-foreground/20 px-2 py-1 text-xs"
              >
                Cancel
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={onToggleExpanded}
              className="text-left"
              aria-expanded={expanded}
            >
              <span className="font-medium">{ingredient.name}</span>
              <span className="ml-2 text-sm text-foreground/60">{ingredient.stockUnit}</span>
              {ingredient.isHandDepleted ? (
                <span className="ml-2 rounded-full border border-foreground/20 px-2 py-0.5 text-xs text-foreground/60">
                  Hand-Depleted
                </span>
              ) : null}
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 text-sm">
          {!editingName ? (
            <button
              type="button"
              onClick={() => setEditingName(true)}
              className="rounded-md border border-foreground/20 px-2 py-1 text-xs"
            >
              Rename
            </button>
          ) : null}
          <label className="flex items-center gap-1 text-xs text-foreground/60">
            <input
              type="checkbox"
              checked={ingredient.isHandDepleted}
              disabled={busy}
              onChange={handleToggle}
            />
            Hand-Depleted
          </label>
          <button
            type="button"
            onClick={handleDeleteClick}
            disabled={busy}
            className="rounded-md border border-foreground/20 px-2 py-1 text-xs text-red-600 disabled:opacity-50"
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

      {expanded ? <IngredientDetail ingredientId={ingredient.id} /> : null}
    </li>
  );
}

function IngredientDetail({ ingredientId }: { ingredientId: string }) {
  const [aliases, setAliases] = useState<IngredientAlias[]>([]);
  const [conversions, setConversions] = useState<UnitConversion[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setState("loading");
    setError(null);
    try {
      const supabase = createClient();
      const [aliasRows, conversionRows] = await Promise.all([
        listAliases(supabase, ingredientId),
        listUnitConversions(supabase, ingredientId),
      ]);
      setAliases(aliasRows);
      setConversions(conversionRows);
      setState("loaded");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load details");
      setState("error");
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ingredientId]);

  async function handleAddAlias(alias: string) {
    const supabase = createClient();
    await addAlias(supabase, ingredientId, alias);
    await refresh();
  }

  async function handleRemoveAlias(aliasId: string) {
    const supabase = createClient();
    await removeAlias(supabase, aliasId);
    await refresh();
  }

  async function handleAddConversion(input: { fromUnit: string; factorToStockUnit: number }) {
    const supabase = createClient();
    await addUnitConversion(supabase, ingredientId, input);
    await refresh();
  }

  async function handleRemoveConversion(unitConversionId: string) {
    const supabase = createClient();
    await removeUnitConversion(supabase, unitConversionId);
    await refresh();
  }

  if (state === "loading") {
    return <p className="mt-3 text-sm text-foreground/60">Loading details…</p>;
  }

  if (state === "error") {
    return (
      <p role="alert" className="mt-3 text-sm text-red-600">
        {error}
      </p>
    );
  }

  return (
    <div className="mt-3 grid gap-4 rounded-md bg-foreground/5 p-3 sm:grid-cols-2">
      <AliasManager aliases={aliases} onAdd={handleAddAlias} onRemove={handleRemoveAlias} />
      <ConversionManager
        conversions={conversions}
        onAdd={handleAddConversion}
        onRemove={handleRemoveConversion}
      />
    </div>
  );
}

function AliasManager({
  aliases,
  onAdd,
  onRemove,
}: {
  aliases: IngredientAlias[];
  onAdd: (alias: string) => Promise<void>;
  onRemove: (aliasId: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onAdd(draft);
      setDraft("");
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "Failed to add Alias");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2 className="text-sm font-semibold">Aliases</h2>
      <ul className="mt-2 space-y-1">
        {aliases.length === 0 ? (
          <li className="text-sm text-foreground/60">No Aliases yet.</li>
        ) : (
          aliases.map((alias) => (
            <li key={alias.id} className="flex items-center justify-between text-sm">
              <span>{alias.alias}</span>
              <button
                type="button"
                onClick={() => onRemove(alias.id)}
                className="text-xs text-red-600"
              >
                Remove
              </button>
            </li>
          ))
        )}
      </ul>
      <form onSubmit={handleSubmit} className="mt-2 flex items-center gap-2">
        <label htmlFor="alias-draft" className="sr-only">
          New alias
        </label>
        <input
          id="alias-draft"
          required
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Leak"
          className="w-full rounded-md border border-foreground/20 bg-transparent px-2 py-1 text-sm outline-none focus:border-foreground/50"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-md border border-foreground/20 px-2 py-1 text-xs disabled:opacity-50"
        >
          Add
        </button>
      </form>
      {error ? (
        <p role="alert" className="mt-1 text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ConversionManager({
  conversions,
  onAdd,
  onRemove,
}: {
  conversions: UnitConversion[];
  onAdd: (input: { fromUnit: string; factorToStockUnit: number }) => Promise<void>;
  onRemove: (unitConversionId: string) => Promise<void>;
}) {
  const [fromUnit, setFromUnit] = useState("");
  const [factor, setFactor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onAdd({ fromUnit, factorToStockUnit: Number(factor) });
      setFromUnit("");
      setFactor("");
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "Failed to add Convertible Unit");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2 className="text-sm font-semibold">Convertible Units</h2>
      <ul className="mt-2 space-y-1">
        {conversions.length === 0 ? (
          <li className="text-sm text-foreground/60">No Convertible Units yet.</li>
        ) : (
          conversions.map((conversion) => (
            <li key={conversion.id} className="flex items-center justify-between text-sm">
              <span>
                1 {conversion.fromUnit} = {conversion.factorToStockUnit}
              </span>
              <button
                type="button"
                onClick={() => onRemove(conversion.id)}
                className="text-xs text-red-600"
              >
                Remove
              </button>
            </li>
          ))
        )}
      </ul>
      <form onSubmit={handleSubmit} className="mt-2 flex items-center gap-2">
        <label htmlFor="conversion-unit" className="sr-only">
          Unit
        </label>
        <input
          id="conversion-unit"
          required
          value={fromUnit}
          onChange={(event) => setFromUnit(event.target.value)}
          placeholder="cup"
          className="w-1/2 rounded-md border border-foreground/20 bg-transparent px-2 py-1 text-sm outline-none focus:border-foreground/50"
        />
        <label htmlFor="conversion-factor" className="sr-only">
          Factor to Stock Unit
        </label>
        <input
          id="conversion-factor"
          required
          type="number"
          step="any"
          min="0"
          value={factor}
          onChange={(event) => setFactor(event.target.value)}
          placeholder="120"
          className="w-1/2 rounded-md border border-foreground/20 bg-transparent px-2 py-1 text-sm outline-none focus:border-foreground/50"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-md border border-foreground/20 px-2 py-1 text-xs disabled:opacity-50"
        >
          Add
        </button>
      </form>
      {error ? (
        <p role="alert" className="mt-1 text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
