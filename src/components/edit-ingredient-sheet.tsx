"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateIngredientCategory, updateIngredientUnit } from "@/actions/ingredients";
import { type UnitCode, siblingUnits } from "@/domain/units";
import type { PantryRow } from "@/lib/pantry";

const UNIT_OPTIONS: readonly UnitCode[] = [
  "g",
  "kg",
  "ml",
  "l",
  "each",
  "clove",
  "slice",
  "rasher",
  "fillet",
  "head",
  "bunch",
  "sprig",
  "can",
  "pack",
];

export function EditIngredientSheet({
  row,
  categories,
  onClose,
}: {
  row: PantryRow;
  categories: readonly string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [unit, setUnit] = useState<UnitCode>(row.stockUnit);
  const [category, setCategory] = useState(row.category);
  const [grams, setGrams] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const changing = unit !== row.stockUnit;
  const needsWeight = changing && siblingUnits(row.stockUnit).length === 1;

  function save() {
    setError(null);
    startTransition(async () => {
      if (category.trim() !== "" && category.trim() !== row.category) {
        const moved = await updateIngredientCategory({
          ingredientId: row.id,
          category: category.trim(),
        });
        if (moved.error) {
          setError(moved.error);
          return;
        }
      }

      if (changing || grams.trim() !== "") {
        const result = await updateIngredientUnit({
          ingredientId: row.id,
          stockUnit: unit,
          gramsPerUnit: grams.trim() === "" ? undefined : Number(grams),
        });
        if (result.error) {
          setError(result.error);
          return;
        }
      }

      router.refresh();
      onClose();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${row.name}`}
        className="max-h-[90dvh] w-full max-w-md space-y-4 overflow-y-auto rounded-t-2xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-xl sm:rounded-2xl sm:pb-5 dark:bg-neutral-950"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">{row.name}</h2>
            <p className="text-sm text-neutral-500">
              Counted in {row.stockUnit} · {row.display} on hand
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-neutral-500 underline-offset-4 hover:underline"
          >
            Close
          </button>
        </div>

        <label className="block space-y-1 text-sm">
          <span className="font-medium">Category</span>
          <input
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            list="edit-ingredient-categories"
            placeholder="Category"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
          />
          <datalist id="edit-ingredient-categories">
            {categories.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
          <span className="block text-xs text-neutral-500">
            Type a new name to create a category.
          </span>
        </label>

        <label className="block space-y-1 text-sm">
          <span className="font-medium">Count it in</span>
          <select
            value={unit}
            onChange={(event) => {
              setUnit(event.target.value as UnitCode);
              setError(null);
            }}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
          >
            {[...new Set([row.stockUnit, ...UNIT_OPTIONS])].map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        {(changing || grams !== "") && (
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Grams per {unit}</span>
            <input
              type="number"
              min="0.1"
              step="any"
              value={grams}
              onChange={(event) => setGrams(event.target.value)}
              placeholder={needsWeight ? "e.g. 10" : "optional"}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
            />
            <span className="block text-xs text-neutral-500">
              Only needed when the old and new units can&apos;t be compared directly. Converting
              updates every existing stock entry, not just the label.
            </span>
          </label>
        )}

        {error !== null && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
        >
          {pending ? "Saving…" : changing ? `Convert to ${unit}` : "Save"}
        </button>
      </div>
    </div>
  );
}
