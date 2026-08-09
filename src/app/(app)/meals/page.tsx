"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  addPortionBatch,
  eatPortion,
  listMealStock,
  listPortionBatches,
  recordAteOut,
  updatePortionBatch,
  type MealStockRow,
  type PortionBatch,
} from "@/lib/meals";
import {
  STORAGE_LOCATIONS,
  STORAGE_LOCATION_LABELS,
  type StorageLocation,
} from "@/lib/pantry/types";

type LoadState = "loading" | "loaded" | "error";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Meal Stock: food actually available, independent of any Meal Plan. */
export default function MealsPage() {
  const [stock, setStock] = useState<MealStockRow[]>([]);
  const [batches, setBatches] = useState<PortionBatch[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setState("loading");
    setError(null);
    try {
      const client = createClient();
      const [stockRows, batchRows] = await Promise.all([listMealStock(client), listPortionBatches(client)]);
      setStock(stockRows);
      setBatches(batchRows);
      setState("loaded");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load Meal Stock");
      setState("error");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="space-y-6 pb-16">
      <div>
        <h1 className="text-xl font-semibold">Meal Stock</h1>
        <p className="mt-2 text-sm text-foreground/60">
          Portions you actually have. Eating always uses oldest Batch first.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ReadyMealForm onAdded={refresh} />
        <AteOutForm onRecorded={refresh} />
      </div>

      {state === "loading" ? <p className="text-sm text-foreground/60">Loading…</p> : null}
      {state === "error" ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
      {state === "loaded" && stock.length === 0 ? (
        <p data-testid="meal-stock-empty" className="text-sm text-foreground/60">No Portions yet. Cook a Recipe or add a ready meal.</p>
      ) : null}
      {state === "loaded" && stock.length > 0 ? (
        <section aria-label="Available Meal Stock" className="divide-y divide-foreground/10 rounded-md border border-foreground/10">
          {stock.map((row) => (
            <MealStockItem
              key={`${row.recipeId ?? "ready"}:${row.label ?? ""}`}
              row={row}
              batches={batches}
              onChanged={refresh}
            />
          ))}
        </section>
      ) : null}

      {state === "loaded" ? <BatchEditor batches={batches} onChanged={refresh} /> : null}
    </div>
  );
}

function ReadyMealForm({ onAdded }: { onAdded: () => Promise<void> }) {
  const [label, setLabel] = useState("");
  const [portions, setPortions] = useState("");
  const [location, setLocation] = useState<StorageLocation>("fridge");
  const [cookedOn, setCookedOn] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      await addPortionBatch(createClient(), { label, portions: Number(portions), storageLocation: location, cookedOn });
      setLabel(""); setPortions("");
      await onAdded();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to add ready meal");
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="grid gap-2 rounded-md border border-foreground/10 p-4 sm:grid-cols-2">
      <h2 className="text-sm font-semibold sm:col-span-2">Add ready meal</h2>
      <label className="space-y-1 text-xs text-foreground/60">Ready meal name
        <input aria-label="Ready meal name" required value={label} onChange={(event) => setLabel(event.target.value)} className="mt-1 w-full rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-sm text-foreground" />
      </label>
      <label className="space-y-1 text-xs text-foreground/60">Portions
        <input aria-label="Portions" required type="number" min="1" value={portions} onChange={(event) => setPortions(event.target.value)} className="mt-1 w-full rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-sm text-foreground" />
      </label>
      <label className="space-y-1 text-xs text-foreground/60">Storage Location
        <select value={location} onChange={(event) => setLocation(event.target.value as StorageLocation)} className="mt-1 w-full rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-sm text-foreground">
          {STORAGE_LOCATIONS.map((item) => <option key={item} value={item}>{STORAGE_LOCATION_LABELS[item]}</option>)}
        </select>
      </label>
      <label className="space-y-1 text-xs text-foreground/60">Date
        <input required type="date" value={cookedOn} onChange={(event) => setCookedOn(event.target.value)} className="mt-1 w-full rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-sm text-foreground" />
      </label>
      <button type="submit" disabled={busy} className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-50 sm:col-span-2">{busy ? "Adding…" : "Add ready meal"}</button>
      {error ? <p role="alert" className="text-sm text-red-600 sm:col-span-2">{error}</p> : null}
    </form>
  );
}

function AteOutForm({ onRecorded }: { onRecorded: () => Promise<void> }) {
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      await recordAteOut(createClient(), { description });
      setDescription(""); await onRecorded();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to record Ate Out");
    } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="space-y-2 rounded-md border border-foreground/10 p-4">
      <h2 className="text-sm font-semibold">Ate Out</h2>
      <label className="block text-xs text-foreground/60">Ate Out description
        <input aria-label="Ate Out description" required value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Restaurant or takeaway" className="mt-1 w-full rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-sm text-foreground" />
      </label>
      <button type="submit" disabled={busy} className="rounded-md border border-foreground/20 px-3 py-2 text-sm font-medium disabled:opacity-50">{busy ? "Recording…" : "Record Ate Out"}</button>
      {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
    </form>
  );
}

function MealStockItem({ row, batches, onChanged }: { row: MealStockRow; batches: PortionBatch[]; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const oldestBatch = useMemo(() => batches
    .filter((batch) => batch.portionsRemaining > 0 && (row.recipeId ? batch.recipeId === row.recipeId : batch.recipeId === null && batch.label === row.label))
    .sort((left, right) => left.cookedOn.localeCompare(right.cookedOn))[0], [batches, row.label, row.recipeId]);

  async function eat() {
    setBusy(true); setError(null);
    try {
      await eatPortion(createClient(), row.recipeId ? { recipeId: row.recipeId } : { portionBatchId: oldestBatch?.id });
      await onChanged();
    } catch (eatError) {
      setError(eatError instanceof Error ? eatError.message : "Failed to eat Portion");
    } finally { setBusy(false); }
  }

  return <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
    <div>
      <h2 className="font-medium">{row.displayName}</h2>
      <p className="text-sm text-foreground/60">{row.totalPortions} Portions · oldest {row.oldestCookedOn}</p>
    </div>
    <div className="flex items-center gap-2">
      <button type="button" onClick={eat} disabled={busy || !oldestBatch} aria-label={`Eat ${row.displayName}`} className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-50">{busy ? "Eating…" : "Eat"}</button>
      {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
    </div>
  </div>;
}

function BatchEditor({ batches, onChanged }: { batches: PortionBatch[]; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState<string | null>(null);
  if (batches.length === 0) return null;
  return <section aria-label="Edit Portion Batches" className="space-y-2">
    <h2 className="text-sm font-semibold text-foreground/60">Portion Batches</h2>
    <ul className="space-y-2">{batches.map((batch) => <BatchRow key={batch.id} batch={batch} editing={editing === batch.id} onEdit={() => setEditing(batch.id)} onCancel={() => setEditing(null)} onChanged={async () => { setEditing(null); await onChanged(); }} />)}</ul>
  </section>;
}

function BatchRow({ batch, editing, onEdit, onCancel, onChanged }: { batch: PortionBatch; editing: boolean; onEdit: () => void; onCancel: () => void; onChanged: () => Promise<void> }) {
  const [portions, setPortions] = useState(String(batch.portionsRemaining));
  const [location, setLocation] = useState<StorageLocation>(batch.storageLocation);
  const [cookedOn, setCookedOn] = useState(batch.cookedOn);
  const [label, setLabel] = useState(batch.label ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      await updatePortionBatch(createClient(), batch.id, {
        portionsRemaining: Number(portions), storageLocation: location, cookedOn,
        ...(batch.recipeId === null ? { label } : {}),
      });
      await onChanged();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Failed to edit Batch"); }
    finally { setBusy(false); }
  }
  return <li className="rounded-md border border-foreground/10 p-3 text-sm">
    {editing ? <form onSubmit={submit} className="grid gap-2 sm:grid-cols-4">
      {batch.recipeId === null ? <label className="text-xs text-foreground/60">Name<input aria-label={`Name for ${batch.label ?? "ready meal"}`} value={label} onChange={(event) => setLabel(event.target.value)} className="mt-1 w-full rounded-md border border-foreground/20 bg-transparent px-2 py-1 text-sm" /></label> : null}
      <label className="text-xs text-foreground/60">Portions<input aria-label={`Portions for ${batch.label ?? "Recipe Batch"}`} type="number" min="0" value={portions} onChange={(event) => setPortions(event.target.value)} className="mt-1 w-full rounded-md border border-foreground/20 bg-transparent px-2 py-1 text-sm" /></label>
      <label className="text-xs text-foreground/60">Location<select aria-label={`Location for ${batch.label ?? "Recipe Batch"}`} value={location} onChange={(event) => setLocation(event.target.value as StorageLocation)} className="mt-1 w-full rounded-md border border-foreground/20 bg-transparent px-2 py-1 text-sm">{STORAGE_LOCATIONS.map((item) => <option key={item} value={item}>{STORAGE_LOCATION_LABELS[item]}</option>)}</select></label>
      <label className="text-xs text-foreground/60">Date<input aria-label={`Date for ${batch.label ?? "Recipe Batch"}`} type="date" value={cookedOn} onChange={(event) => setCookedOn(event.target.value)} className="mt-1 w-full rounded-md border border-foreground/20 bg-transparent px-2 py-1 text-sm" /></label>
      <div className="flex gap-2"><button type="submit" disabled={busy} className="rounded-md border border-foreground/20 px-2 py-1">Save</button><button type="button" onClick={onCancel} className="rounded-md border border-foreground/20 px-2 py-1">Cancel</button></div>
    </form> : <div className="flex items-center justify-between gap-2"><span>{batch.label ?? "Recipe Batch"}: {batch.portionsRemaining} Portions · {batch.cookedOn} · {STORAGE_LOCATION_LABELS[batch.storageLocation]}</span><button type="button" onClick={onEdit} className="rounded-md border border-foreground/20 px-2 py-1">Edit</button></div>}
    {error ? <p role="alert" className="mt-1 text-red-600">{error}</p> : null}
  </li>;
}
