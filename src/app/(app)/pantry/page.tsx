"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  addStock,
  consumeStock,
  deleteStockLot,
  listPantrySummary,
  listStockLots,
  setHandDepletedFraction,
  updateStockLot,
} from "@/lib/pantry/pantry";
import { listIngredients } from "@/lib/ingredients/registry";
import { ageBadge, type AgeBadgeLevel } from "@/lib/pantry/age";
import {
  STORAGE_LOCATIONS,
  STORAGE_LOCATION_LABELS,
  type PantrySummaryRow,
  type StockLot,
  type StorageLocation,
} from "@/lib/pantry/types";
import type { Ingredient } from "@/lib/ingredients/types";

type LoadState = "loading" | "loaded" | "error";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Pantry screen (#5): what you actually have, grouped by Storage Location
 * with one row per Ingredient. The interesting logic — same-day merge,
 * FIFO consumption, floor-at-zero, Hand-Depleted exclusion — lives in
 * Postgres and is exercised by pgTAP; this screen is a thin read/write
 * layer over `pantry_summary` and `stock_lots`, mirroring the shape of
 * src/app/(app)/ingredients/page.tsx.
 */
export default function PantryPage() {
  const [rows, setRows] = useState<PantrySummaryRow[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  async function refresh() {
    setLoadState("loading");
    setErrorMessage(null);
    try {
      const supabase = createClient();
      const [summaryRows, ingredientRows] = await Promise.all([
        listPantrySummary(supabase),
        listIngredients(supabase),
      ]);
      setRows(summaryRows);
      setIngredients(ingredientRows);
      setLoadState("loaded");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load the Pantry");
      setLoadState("error");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<StorageLocation, PantrySummaryRow[]>();
    for (const location of STORAGE_LOCATIONS) map.set(location, []);
    for (const row of rows) {
      map.get(row.storageLocation)?.push(row);
    }
    return map;
  }, [rows]);

  async function handleAddStock(input: {
    ingredientId: string;
    quantity: number;
    storageLocation: StorageLocation;
    acquiredOn: string;
  }) {
    const supabase = createClient();
    const ingredient = ingredients.find((i) => i.id === input.ingredientId);
    if (ingredient?.isHandDepleted) {
      await setHandDepletedFraction(supabase, input);
    } else {
      await addStock(supabase, input);
    }
    await refresh();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Pantry</h1>
        <p className="mt-2 text-sm text-foreground/60">
          What you actually have, held as Stock Lots — grouped by where it physically sits.
        </p>
      </div>

      <AddStockForm ingredients={ingredients} onAdd={handleAddStock} />

      {loadState === "loading" ? (
        <p className="text-sm text-foreground/60">Loading…</p>
      ) : loadState === "error" ? (
        <p role="alert" className="text-sm text-red-600">
          {errorMessage}
        </p>
      ) : rows.length === 0 ? (
        <p data-testid="pantry-empty" className="text-sm text-foreground/60">
          No stock yet. Add some above.
        </p>
      ) : (
        <div className="space-y-6">
          {STORAGE_LOCATIONS.map((location) => {
            const locationRows = grouped.get(location) ?? [];
            if (locationRows.length === 0) return null;
            return (
              <section key={location} aria-label={STORAGE_LOCATION_LABELS[location]}>
                <h2 className="text-sm font-semibold text-foreground/80">
                  {STORAGE_LOCATION_LABELS[location]}
                </h2>
                <ul className="mt-2 divide-y divide-foreground/10">
                  {locationRows.map((row) => {
                    const key = `${row.ingredientId}:${row.storageLocation}`;
                    return (
                      <PantryRow
                        key={key}
                        row={row}
                        expanded={expandedKey === key}
                        onToggleExpanded={() =>
                          setExpandedKey(expandedKey === key ? null : key)
                        }
                        onChanged={refresh}
                      />
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AddStockForm({
  ingredients,
  onAdd,
}: {
  ingredients: Ingredient[];
  onAdd: (input: {
    ingredientId: string;
    quantity: number;
    storageLocation: StorageLocation;
    acquiredOn: string;
  }) => Promise<void>;
}) {
  const [ingredientId, setIngredientId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [storageLocation, setStorageLocation] = useState<StorageLocation>("fridge");
  const [acquiredOn, setAcquiredOn] = useState(todayIso());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onAdd({
        ingredientId,
        quantity: Number(quantity),
        storageLocation,
        acquiredOn,
      });
      setQuantity("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to add stock");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="grid gap-2 rounded-md border border-foreground/10 p-4 sm:grid-cols-4 sm:items-end"
    >
      <div className="space-y-1 sm:col-span-2">
        <label htmlFor="stock-ingredient" className="text-xs font-medium text-foreground/60">
          Ingredient
        </label>
        <select
          id="stock-ingredient"
          required
          value={ingredientId}
          onChange={(event) => setIngredientId(event.target.value)}
          className="w-full rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/50"
        >
          <option value="" disabled>
            Choose an Ingredient
          </option>
          {ingredients.map((ingredient) => (
            <option key={ingredient.id} value={ingredient.id}>
              {ingredient.name}
              {ingredient.isHandDepleted ? " (Hand-Depleted)" : ""}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label htmlFor="stock-quantity" className="text-xs font-medium text-foreground/60">
          Quantity
        </label>
        <input
          id="stock-quantity"
          required
          type="number"
          step="any"
          min="0"
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          placeholder="4"
          className="w-full rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/50"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="stock-location" className="text-xs font-medium text-foreground/60">
          Storage Location
        </label>
        <select
          id="stock-location"
          value={storageLocation}
          onChange={(event) => setStorageLocation(event.target.value as StorageLocation)}
          className="w-full rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/50"
        >
          {STORAGE_LOCATIONS.map((location) => (
            <option key={location} value={location}>
              {STORAGE_LOCATION_LABELS[location]}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label htmlFor="stock-date" className="text-xs font-medium text-foreground/60">
          Date
        </label>
        <input
          id="stock-date"
          required
          type="date"
          value={acquiredOn}
          onChange={(event) => setAcquiredOn(event.target.value)}
          className="w-full rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/50"
        />
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-50 sm:col-span-4"
      >
        {submitting ? "Adding…" : "Add stock"}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-red-600 sm:col-span-4">
          {error}
        </p>
      ) : null}
    </form>
  );
}

const BADGE_STYLES: Record<AgeBadgeLevel, string> = {
  fresh: "border-foreground/20 text-foreground/60",
  aging: "border-amber-500/40 text-amber-600",
  old: "border-red-500/40 text-red-600",
};

function AgeBadgeLabel({ row }: { row: PantrySummaryRow }) {
  const badge = ageBadge(row.oldestAcquiredOn, row.storageLocation);
  return (
    <span
      data-testid="age-badge"
      className={`ml-2 rounded-full border px-2 py-0.5 text-xs ${BADGE_STYLES[badge.level]}`}
    >
      {badge.ageDays === 0 ? "today" : `${badge.ageDays}d old`}
    </span>
  );
}

function PantryRow({
  row,
  expanded,
  onToggleExpanded,
  onChanged,
}: {
  row: PantrySummaryRow;
  expanded: boolean;
  onToggleExpanded: () => void;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consumeDraft, setConsumeDraft] = useState("");
  const [fractionDraft, setFractionDraft] = useState(String(row.totalQuantity));
  const [shortfallNotice, setShortfallNotice] = useState<string | null>(null);

  async function handleConsume(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setShortfallNotice(null);
    try {
      const supabase = createClient();
      const result = await consumeStock(supabase, row.ingredientId, Number(consumeDraft));
      setConsumeDraft("");
      if (result.shortfall > 0) {
        setShortfallNotice(
          `Only ${result.consumed} ${row.stockUnit} available — asked for ${result.requested}, short by ${result.shortfall}.`
        );
      }
      await onChanged();
    } catch (consumeError) {
      setError(consumeError instanceof Error ? consumeError.message : "Failed to consume stock");
    } finally {
      setBusy(false);
    }
  }

  async function handleSetFraction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      await setHandDepletedFraction(supabase, {
        ingredientId: row.ingredientId,
        quantity: Number(fractionDraft),
        storageLocation: row.storageLocation,
      });
      await onChanged();
    } catch (fractionError) {
      setError(fractionError instanceof Error ? fractionError.message : "Failed to update");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={onToggleExpanded}
          className="text-left"
          aria-expanded={expanded}
        >
          <span className="font-medium">{row.ingredientName}</span>
          <span className="ml-2 text-sm text-foreground/60">
            {row.totalQuantity} {row.stockUnit}
          </span>
          <AgeBadgeLabel row={row} />
          {row.isHandDepleted ? (
            <span className="ml-2 rounded-full border border-foreground/20 px-2 py-0.5 text-xs text-foreground/60">
              Hand-Depleted
            </span>
          ) : null}
        </button>

        {row.isHandDepleted ? (
          <form onSubmit={handleSetFraction} className="flex items-center gap-2 text-sm">
            <label htmlFor={`fraction-${row.ingredientId}-${row.storageLocation}`} className="sr-only">
              Set fraction remaining for {row.ingredientName}
            </label>
            <input
              id={`fraction-${row.ingredientId}-${row.storageLocation}`}
              type="number"
              step="any"
              min="0"
              value={fractionDraft}
              onChange={(event) => setFractionDraft(event.target.value)}
              className="w-20 rounded-md border border-foreground/20 bg-transparent px-2 py-1 text-sm outline-none focus:border-foreground/50"
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded-md border border-foreground/20 px-2 py-1 text-xs disabled:opacity-50"
            >
              Set
            </button>
          </form>
        ) : (
          <form onSubmit={handleConsume} className="flex items-center gap-2 text-sm">
            <label htmlFor={`consume-${row.ingredientId}-${row.storageLocation}`} className="sr-only">
              Consume {row.ingredientName}
            </label>
            <input
              id={`consume-${row.ingredientId}-${row.storageLocation}`}
              type="number"
              step="any"
              min="0"
              required
              value={consumeDraft}
              onChange={(event) => setConsumeDraft(event.target.value)}
              placeholder="Consume"
              className="w-24 rounded-md border border-foreground/20 bg-transparent px-2 py-1 text-sm outline-none focus:border-foreground/50"
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded-md border border-foreground/20 px-2 py-1 text-xs disabled:opacity-50"
            >
              Consume
            </button>
          </form>
        )}
      </div>

      {shortfallNotice ? (
        <p role="status" className="mt-1 text-sm text-amber-600">
          {shortfallNotice}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-1 text-sm text-red-600">
          {error}
        </p>
      ) : null}

      {expanded ? (
        <StockLotDetail
          ingredientId={row.ingredientId}
          stockUnit={row.stockUnit}
          onChanged={onChanged}
        />
      ) : null}
    </li>
  );
}

function StockLotDetail({
  ingredientId,
  stockUnit,
  onChanged,
}: {
  ingredientId: string;
  stockUnit: string;
  onChanged: () => Promise<void>;
}) {
  const [lots, setLots] = useState<StockLot[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setState("loading");
    setError(null);
    try {
      const supabase = createClient();
      const rows = await listStockLots(supabase, ingredientId);
      setLots(rows);
      setState("loaded");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load Lots");
      setState("error");
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ingredientId]);

  async function handleEditQuantity(lotId: string, quantity: number) {
    const supabase = createClient();
    await updateStockLot(supabase, lotId, { quantity });
    await refresh();
    await onChanged();
  }

  async function handleDelete(lotId: string) {
    const supabase = createClient();
    await deleteStockLot(supabase, lotId);
    await refresh();
    await onChanged();
  }

  if (state === "loading") {
    return <p className="mt-3 text-sm text-foreground/60">Loading Lots…</p>;
  }

  if (state === "error") {
    return (
      <p role="alert" className="mt-3 text-sm text-red-600">
        {error}
      </p>
    );
  }

  return (
    <ul className="mt-3 space-y-2 rounded-md bg-foreground/5 p-3">
      {lots.map((lot) => (
        <StockLotRow
          key={lot.id}
          lot={lot}
          stockUnit={stockUnit}
          onEditQuantity={(quantity) => handleEditQuantity(lot.id, quantity)}
          onDelete={() => handleDelete(lot.id)}
        />
      ))}
    </ul>
  );
}

function StockLotRow({
  lot,
  stockUnit,
  onEditQuantity,
  onDelete,
}: {
  lot: StockLot;
  stockUnit: string;
  onEditQuantity: (quantity: number) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(lot.quantity));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const badge = ageBadge(lot.acquiredOn, lot.storageLocation);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onEditQuantity(Number(draft));
      setEditing(false);
    } catch (editError) {
      setError(editError instanceof Error ? editError.message : "Failed to edit Lot");
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
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete Lot");
      setBusy(false);
    }
  }

  return (
    <li className="flex items-center justify-between text-sm" data-testid="stock-lot-row">
      {editing ? (
        <form onSubmit={handleSubmit} className="flex flex-1 items-center gap-2">
          <label htmlFor={`edit-lot-${lot.id}`} className="sr-only">
            Quantity for Lot acquired {lot.acquiredOn}
          </label>
          <input
            id={`edit-lot-${lot.id}`}
            type="number"
            step="any"
            min="0"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="w-20 rounded-md border border-foreground/20 bg-transparent px-2 py-1 text-sm outline-none focus:border-foreground/50"
          />
          <button type="submit" disabled={busy} className="rounded-md border border-foreground/20 px-2 py-1 text-xs">
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setDraft(String(lot.quantity));
            }}
            className="rounded-md border border-foreground/20 px-2 py-1 text-xs"
          >
            Cancel
          </button>
        </form>
      ) : (
        <span>
          {lot.quantity} {stockUnit} — acquired {lot.acquiredOn}
          <span className="ml-2 text-xs text-foreground/50">
            ({badge.ageDays === 0 ? "today" : `${badge.ageDays}d old`})
          </span>
        </span>
      )}

      <div className="flex items-center gap-2">
        {!editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-md border border-foreground/20 px-2 py-1 text-xs"
          >
            Edit
          </button>
        ) : null}
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
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </li>
  );
}
