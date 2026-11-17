"use client";

import { type FormEvent, useState, useTransition } from "react";
import { adjustStock } from "@/actions/stock";
import { siblingUnits, type UnitCode } from "@/domain/units";
import type { IngredientOption } from "@/lib/catalogue";
import { IngredientPicker } from "./ingredient-picker";

/**
 * Add stock without hunting for the row: pick (or create) an ingredient, then
 * give an amount. Writes a purchase lot with a shelf-life best-before unless
 * you override it.
 */
export function AddStockSheet({
  ingredients,
  onClose,
}: {
  ingredients: readonly IngredientOption[];
  onClose: () => void;
}) {
  const [catalogue, setCatalogue] = useState<IngredientOption[]>([...ingredients]);
  const [selected, setSelected] = useState<IngredientOption | null>(null);
  const [unit, setUnit] = useState<UnitCode>("g");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const units = selected ? siblingUnits(selected.stockUnit) : ["g"];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!selected) {
      setError("Pick an ingredient first.");
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    formData.set("ingredientId", selected.id);
    formData.set("mode", "add");

    startTransition(async () => {
      const result = await adjustStock(formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      onClose();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add to pantry"
        className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl dark:bg-neutral-950"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Add to pantry</h2>
            <p className="text-sm text-neutral-500">New ingredients can be created from the search.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-neutral-500 underline-offset-4 hover:underline"
          >
            Close
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Ingredient</span>
            <IngredientPicker
              options={catalogue}
              value={selected?.id ?? ""}
              onSelect={(option) => {
                setCatalogue((current) =>
                  current.some((item) => item.id === option.id) ? current : [...current, option],
                );
                setSelected(option);
                setUnit(siblingUnits(option.stockUnit)[0] ?? "g");
                setError(null);
              }}
            />
          </label>

          <div className="grid grid-cols-[1fr_7rem] gap-2">
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Amount</span>
              <input
                name="amount"
                type="number"
                step="any"
                min="0.01"
                required
                placeholder="0"
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-100"
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Unit</span>
              <select
                name="unit"
                value={unit}
                onChange={(event) => setUnit(event.target.value as UnitCode)}
                className="w-full rounded-lg border border-neutral-300 px-2 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              >
                {units.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block space-y-1 text-sm">
            <span className="font-medium">Best before</span>
            <input
              name="bestBefore"
              type="date"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
            <span className="text-xs text-neutral-500">
              Leave blank to use this ingredient&apos;s shelf life.
            </span>
          </label>

          <label className="block space-y-1 text-sm">
            <span className="font-medium">Note</span>
            <input
              name="note"
              maxLength={200}
              placeholder="Top-up shop"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>

          {error !== null && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending || selected === null}
            className="w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
          >
            {pending ? "Adding…" : "Add to pantry"}
          </button>
        </form>
      </div>
    </div>
  );
}
