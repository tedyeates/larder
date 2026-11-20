"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateIngredientCategory, updateIngredientUnit } from "@/actions/ingredients";
import { type UnitCode, unitFamily } from "@/domain/units";
import type { PantryRow } from "@/lib/pantry";
import { CategoryPicker } from "./category-picker";

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
  "ball",
  "block",
  "square",
  "scoop",
  "handful",
  "sheet",
  "nest",
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
  const [hints, setHints] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(row.gramsPer ?? {}).map(([hintUnit, grams]) => [hintUnit, String(grams)]),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const changing = unit !== row.stockUnit;
  const family = unitFamily(unit);

  // The weights that make cross-family recipe units (a cup of flour, grams of
  // garlic) resolvable. Mass needs spoon and cup weights; volume needs density.
  function weightUnitsFor(code: UnitCode): UnitCode[] {
    const codeFamily = unitFamily(code);
    if (codeFamily === "mass") return ["tsp", "tbsp", "cup"];
    if (codeFamily === "volume") return ["ml", "tbsp", "cup"];
    return [code];
  }

  // While changing units, keep the old family's weights visible too: converting
  // "each" into grams needs the per-piece weight, not a cup weight.
  const weightUnits = [
    ...new Set([...weightUnitsFor(unit), ...(changing ? weightUnitsFor(row.stockUnit) : [])]),
  ];
  const weightHelp =
    family === "mass"
      ? "Used when a recipe measures this by the cup or spoon."
      : family === "volume"
        ? "Weights that let a recipe measure this in grams."
        : "Used when a recipe weighs this in grams instead of counting it.";

  function save() {
    setError(null);

    const hintChanges: Record<string, number | null> = {};
    for (const hintUnit of weightUnits) {
      const typed = hints[hintUnit]?.trim() ?? "";
      const existing = row.gramsPer?.[hintUnit];

      if (typed === "") {
        if (existing !== undefined) hintChanges[hintUnit] = null;
        continue;
      }

      const grams = Number(typed);
      if (!Number.isFinite(grams) || grams <= 0) {
        setError(`Grams per ${hintUnit} must be a positive number.`);
        return;
      }
      if (grams !== existing) hintChanges[hintUnit] = grams;
    }

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

      if (changing || Object.keys(hintChanges).length > 0) {
        const result = await updateIngredientUnit({
          ingredientId: row.id,
          stockUnit: unit,
          hints: hintChanges,
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

        <div className="block space-y-1 text-sm">
          <span className="font-medium">Category</span>
          <CategoryPicker options={categories} value={category} onChange={setCategory} />
          <span className="block text-xs text-neutral-500">
            Type a new name to create a category.
          </span>
        </div>

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

        <div className="space-y-1 text-sm">
          <span className="font-medium">Recipe measures</span>
          <div className="flex flex-wrap gap-2">
            {weightUnits.map((hintUnit) => (
              <label key={hintUnit} className="min-w-20 flex-1 space-y-1 text-xs">
                <span className="block text-neutral-500">Grams per {hintUnit}</span>
                <input
                  type="number"
                  min="0.1"
                  step="any"
                  value={hints[hintUnit] ?? ""}
                  onChange={(event) => {
                    const value = event.target.value;
                    setHints((current) => ({ ...current, [hintUnit]: value }));
                    setError(null);
                  }}
                  placeholder="optional"
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                />
              </label>
            ))}
          </div>
          <span className="block text-xs text-neutral-500">{weightHelp}</span>
        </div>

        {changing && (
          <p className="text-xs text-neutral-500">
            Converting updates every existing stock entry, not just the label.
          </p>
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
