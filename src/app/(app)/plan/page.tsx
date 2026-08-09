"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { listRecipes } from "@/lib/recipes/recipes";
import type { Recipe } from "@/lib/recipes/types";
import type { CookPreview, CookSubstitutionChoice } from "@/lib/meals";
import {
  ateOutMealPlanSlot,
  clearMealPlanSlot,
  commitPlanCook,
  eatMealPlanSlot,
  listMealPlanSlots,
  moveMealPlanSlot,
  previewPlanCook,
  saveMealPlanSlot,
  topUpMealPlanSlot,
} from "@/lib/plan/plan";
import { MEAL_TIMES, MEAL_TIME_LABELS, type MealPlanSlot, type MealTime } from "@/lib/plan/types";

type LoadState = "loading" | "loaded" | "error";
type EditorTarget = { slotDate: string; mealTime: MealTime; slot?: MealPlanSlot };

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function monday(date: Date): Date {
  const copy = new Date(`${isoDate(date)}T00:00:00.000Z`);
  copy.setUTCDate(copy.getUTCDate() - ((copy.getUTCDay() + 6) % 7));
  return copy;
}

function dayLabel(date: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" }).format(new Date(`${date}T00:00:00Z`));
}

function isPast(date: string): boolean {
  return date < isoDate(new Date());
}

/** Rolling, hand-written Meal Plan. It projects a guide; Cooks and Meal Logs hold reality. */
export default function PlanPage() {
  const [weekStart, setWeekStart] = useState(() => monday(new Date()));
  const [slots, setSlots] = useState<MealPlanSlot[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [preview, setPreview] = useState<{ slotId: string; value: CookPreview } | null>(null);
  const [substitutes, setSubstitutes] = useState<Record<string, string>>({});

  function choicesFor(slotId: string, overrides?: Record<string, string>): CookSubstitutionChoice[] {
    const merged = overrides ? { ...substitutes, ...overrides } : substitutes;
    return Object.entries(merged)
      .filter(([key]) => key.startsWith(`${slotId}:`))
      .map(([key, substituteIngredientId]) => ({ recipeLineId: key.slice(slotId.length + 1), substituteIngredientId }))
      .filter((choice) => choice.substituteIngredientId !== "");
  }

  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => isoDate(addDays(weekStart, index))), [weekStart]);

  async function refresh() {
    setState("loading");
    setError(null);
    try {
      const client = createClient();
      const [planSlots, recipeRows] = await Promise.all([
        listMealPlanSlots(client, isoDate(weekStart), isoDate(weekEnd)),
        listRecipes(client),
      ]);
      setSlots(planSlots);
      setRecipes(recipeRows);
      setState("loaded");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load Meal Plan");
      setState("error");
    }
  }

  useEffect(() => { refresh(); }, [weekStart]);

  async function run(action: () => Promise<void>) {
    try {
      setError(null);
      await action();
      await refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Meal Plan action failed");
    }
  }

  return (
    <div className="space-y-5 pb-20">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Meal Plan</h1>
          <p className="mt-1 text-sm text-foreground/60">Rolling guide. Cooks and Meal Log record what actually happened.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Previous week" onClick={() => setWeekStart((date) => addDays(date, -7))} className="rounded-md border border-foreground/20 px-3 py-2 text-sm">←</button>
          <span className="text-sm font-medium">Week of {isoDate(weekStart)}</span>
          <button type="button" aria-label="Next week" onClick={() => setWeekStart((date) => addDays(date, 7))} className="rounded-md border border-foreground/20 px-3 py-2 text-sm">→</button>
        </div>
      </div>

      {state === "loading" ? <p className="text-sm text-foreground/60">Loading plan…</p> : null}
      {state === "error" ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
      {state === "loaded" && slots.length === 0 ? <p className="text-sm text-foreground/60">No meals planned this week. Add a Recipe or a label to any future Slot.</p> : null}

      <section aria-label={`Meal Plan ${isoDate(weekStart)} to ${isoDate(weekEnd)}`} className="grid gap-3 lg:grid-cols-7">
        {days.map((date) => (
          <div key={date} className="space-y-2 rounded-md border border-foreground/10 p-2">
            <h2 className="text-sm font-semibold">{dayLabel(date)}</h2>
            {MEAL_TIMES.map((mealTime) => {
              const slot = slots.find((item) => item.slotDate === date && item.mealTime === mealTime);
              return <SlotCell
                key={mealTime}
                date={date}
                mealTime={mealTime}
                slot={slot}
                preview={preview && preview.slotId === slot?.id ? preview.value : null}
                onEdit={() => setEditor({ slotDate: date, mealTime, ...(slot ? { slot } : {}) })}
                onClear={() => slot && run(() => clearMealPlanSlot(createClient(), slot.id))}
                onTopUp={() => slot && run(() => topUpMealPlanSlot(createClient(), slot.id))}
                onPreview={() => slot && run(async () => setPreview({ slotId: slot.id, value: await previewPlanCook(createClient(), slot.id, choicesFor(slot.id)) }))}
                onCommit={() => slot && run(async () => { await commitPlanCook(createClient(), slot.id, choicesFor(slot.id)); setPreview(null); })}
                onEat={() => slot && run(() => eatMealPlanSlot(createClient(), slot.id))}
                onAteOut={() => slot && run(() => ateOutMealPlanSlot(createClient(), slot.id))}
                onSubstituteChange={(recipeLineId, substituteIngredientId) => slot && run(async () => {
                  const key = `${slot.id}:${recipeLineId}`;
                  const overrides = { [key]: substituteIngredientId };
                  setSubstitutes((current) => ({ ...current, ...overrides }));
                  setPreview({ slotId: slot.id, value: await previewPlanCook(createClient(), slot.id, choicesFor(slot.id, overrides)) });
                })}
              />;
            })}
          </div>
        ))}
      </section>

      {editor ? <SlotEditor key={`${editor.slot?.id ?? "new"}:${editor.slotDate}:${editor.mealTime}`} target={editor} recipes={recipes} onCancel={() => setEditor(null)} onSaved={async (input) => {
        await run(async () => {
          if (editor.slot && (editor.slot.slotDate !== input.slotDate || editor.slot.mealTime !== input.mealTime)) {
            await moveMealPlanSlot(createClient(), editor.slot.id, input.slotDate, input.mealTime);
          }
          await saveMealPlanSlot(createClient(), input);
          setEditor(null);
        });
      }} /> : null}
    </div>
  );
}

function SlotCell({ date, mealTime, slot, preview, onEdit, onClear, onTopUp, onPreview, onCommit, onEat, onAteOut, onSubstituteChange }: {
  date: string; mealTime: MealTime; slot?: MealPlanSlot; preview: CookPreview | null;
  onEdit: () => void; onClear: () => void; onTopUp: () => void; onPreview: () => void; onCommit: () => void; onEat: () => void; onAteOut: () => void;
  onSubstituteChange: (recipeLineId: string, substituteIngredientId: string) => void;
}) {
  const label = MEAL_TIME_LABELS[mealTime].toLowerCase();
  if (isPast(date)) return <div className="rounded border border-foreground/10 p-2 text-xs text-foreground/60"><strong>{MEAL_TIME_LABELS[mealTime]}</strong><p>{slot?.recipeName ?? slot?.label ?? "Empty"}</p><p>Past slot — read-only</p></div>;
  if (!slot) return <div className="rounded border border-dashed border-foreground/20 p-2"><p className="text-xs font-medium">{MEAL_TIME_LABELS[mealTime]}</p><button type="button" aria-label={`Add ${label} on ${date}`} onClick={onEdit} className="mt-1 text-xs underline">Add meal</button></div>;
  const title = slot.recipeName ?? slot.label ?? "Meal";
  return <article className="space-y-2 rounded border border-foreground/10 p-2 text-sm">
    <p className="text-xs font-medium text-foreground/60">{MEAL_TIME_LABELS[mealTime]}</p>
    <p className="font-medium">{title}</p>
    {slot.isCook ? <p className="text-xs text-foreground/60">Cook occasion ×{slot.cookMultiplier}</p> : slot.recipeId ? <p className="text-xs text-foreground/60">Leftovers</p> : null}
    {slot.recipeId ? <Link href={`/recipes/${slot.recipeId}`} aria-label={`Read ${title} recipe`} className="text-xs underline">Read recipe</Link> : null}
    {slot.isCookable === false ? <div className="space-y-1"><p className="text-xs text-amber-700">Not Cookable</p>{slot.lineStatuses.filter((line) => line.status !== "available").map((line) => <p key={line.recipeLineId} className="text-xs text-amber-700">{line.ingredientName}: {line.status === "missing" ? "Missing" : "Fulfilled by Substitute"}</p>)}<button type="button" aria-label={`Top up ${title}`} onClick={onTopUp} className="text-xs underline">Top-Up</button></div> : null}
    {slot.shortfall ? <p className="text-xs font-medium text-amber-700">Shortfall</p> : null}
    <div className="flex flex-wrap gap-1">
      <button type="button" onClick={onEdit} className="rounded border border-foreground/20 px-2 py-1 text-xs">Edit</button>
      <button type="button" onClick={onClear} className="rounded border border-foreground/20 px-2 py-1 text-xs">Clear</button>
      {slot.recipeId ? <button type="button" aria-label={`Preview cook ${title}`} onClick={onPreview} className="rounded border border-foreground/20 px-2 py-1 text-xs">Cook</button> : null}
      {slot.recipeId ? <button type="button" aria-label={`Mark ${title} eaten`} onClick={onEat} className="rounded border border-foreground/20 px-2 py-1 text-xs">Eaten</button> : null}
      <button type="button" aria-label={`Mark ${title} ate out`} onClick={onAteOut} className="rounded border border-foreground/20 px-2 py-1 text-xs">Ate Out</button>
    </div>
    {preview ? <div className="space-y-2 rounded bg-foreground/5 p-2">
      <p className="text-xs font-medium">Makes {preview.portionsProduced} Portions</p>
      {preview.lines.filter((line) => line.substitutes.length > 0).map((line) => (
        <label key={line.recipeLineId} className="block text-xs">
          Use substitute for {line.ingredientName}
          <select
            aria-label={`Use substitute for ${line.ingredientName}`}
            value={line.substituteIngredientId ?? ""}
            onChange={(event) => onSubstituteChange(line.recipeLineId, event.target.value)}
            className="ml-2 rounded border border-foreground/20 bg-transparent px-1 py-0.5 text-xs"
          >
            <option value="">Use named Ingredient</option>
            {line.substitutes.map((substitute) => <option key={substitute.ingredientId} value={substitute.ingredientId}>{substitute.ingredientName}</option>)}
          </select>
        </label>
      ))}
      {preview.lines.some((line) => line.shortfall > 0 || (line.issue !== null && line.issue !== "hand_depleted")) ? <p className="text-xs text-amber-700">Pantry discrepancies will be clamped at zero.</p> : null}
      <button type="button" onClick={onCommit} className="rounded bg-foreground px-2 py-1 text-xs text-background">Cook anyway</button>
    </div> : null}
  </article>;
}

function SlotEditor({ target, recipes, onCancel, onSaved }: { target: EditorTarget; recipes: Recipe[]; onCancel: () => void; onSaved: (input: { slotDate: string; mealTime: MealTime; recipeId?: string; label?: string; isCook: boolean; cookMultiplier: number }) => Promise<void> }) {
  const [recipeId, setRecipeId] = useState(target.slot?.recipeId ?? "");
  const [label, setLabel] = useState(target.slot?.label ?? "");
  const [isCook, setIsCook] = useState(target.slot?.isCook ?? false);
  const [multiplier, setMultiplier] = useState(String(target.slot?.cookMultiplier ?? 1));
  const [slotDate, setSlotDate] = useState(target.slotDate);
  const [mealTime, setMealTime] = useState<MealTime>(target.mealTime);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedRecipe = recipes.find((recipe) => recipe.id === recipeId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      await onSaved({ slotDate, mealTime, ...(recipeId ? { recipeId } : { label }), isCook: recipeId ? isCook : false, cookMultiplier: Number(multiplier) });
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Failed to save Meal Slot"); }
    finally { setBusy(false); }
  }

  return <form aria-label="Edit Meal Slot" onSubmit={submit} className="grid gap-3 rounded-md border border-foreground/10 p-4 sm:grid-cols-2">
    <h2 className="text-sm font-semibold sm:col-span-2">{target.slot ? "Edit Meal Slot" : "Add Meal Slot"}</h2>
    <label className="text-sm">Recipe<select aria-label="Recipe" value={recipeId} onChange={(event) => { setRecipeId(event.target.value); setLabel(""); }} className="mt-1 w-full rounded border border-foreground/20 bg-transparent px-2 py-1"><option value="">Free-text meal</option>{recipes.map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.name}</option>)}</select></label>
    {!recipeId ? <label className="text-sm">Free-text meal<input aria-label="Free-text meal" required value={label} onChange={(event) => setLabel(event.target.value)} className="mt-1 w-full rounded border border-foreground/20 bg-transparent px-2 py-1" /></label> : <label className="flex items-end gap-2 text-sm"><input type="checkbox" checked={isCook} onChange={(event) => setIsCook(event.target.checked)} />Cook occasion</label>}
    <label className="text-sm">Date<input aria-label="Slot date" type="date" min={isoDate(new Date())} value={slotDate} onChange={(event) => setSlotDate(event.target.value)} className="mt-1 w-full rounded border border-foreground/20 bg-transparent px-2 py-1" /></label>
    <label className="text-sm">Meal<select aria-label="Meal time" value={mealTime} onChange={(event) => setMealTime(event.target.value as MealTime)} className="mt-1 w-full rounded border border-foreground/20 bg-transparent px-2 py-1">{MEAL_TIMES.map((item) => <option key={item} value={item}>{MEAL_TIME_LABELS[item]}</option>)}</select></label>
    {recipeId ? <label className="text-sm">Cook multiplier<input aria-label="Cook multiplier" type="number" min="1" max={selectedRecipe?.maxMultiplier} value={multiplier} onChange={(event) => setMultiplier(event.target.value)} className="mt-1 w-full rounded border border-foreground/20 bg-transparent px-2 py-1" /></label> : null}
    <div className="flex gap-2 sm:col-span-2"><button type="submit" disabled={busy} className="rounded bg-foreground px-3 py-2 text-sm text-background">{busy ? "Saving…" : "Save slot"}</button><button type="button" onClick={onCancel} className="rounded border border-foreground/20 px-3 py-2 text-sm">Cancel</button></div>
    {error ? <p role="alert" className="text-sm text-red-600 sm:col-span-2">{error}</p> : null}
  </form>;
}
