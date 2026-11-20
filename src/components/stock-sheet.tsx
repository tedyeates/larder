"use client";

import { type FormEvent, useState, useTransition } from "react";
import { adjustStock } from "@/actions/stock";
import { entryUnits, type UnitCode } from "@/domain/units";
import type { PantryRow } from "@/lib/pantry";

type Mode = "add" | "use" | "discard";

const MODE_LABEL: Record<Mode, string> = {
  add: "Add stock",
  use: "Use up",
  discard: "Discard",
};

const SUBMIT_LABEL: Record<Mode, string> = {
  add: "Add",
  use: "Use up",
  discard: "Discard",
};

export function StockSheet({ row, onClose }: { row: PantryRow; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("add");
  const [unit, setUnit] = useState<UnitCode>(row.stockUnit);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const units = entryUnits(row);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Adjust ${row.name}`}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-xl sm:rounded-2xl sm:pb-5 dark:bg-neutral-950"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">{row.name}</h2>
            <p className="text-sm text-neutral-500">Now: {row.display}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-neutral-500 underline-offset-4 hover:underline"
          >
            Close
          </button>
        </div>

        <div className="mb-4 grid grid-cols-3 gap-1 rounded-lg bg-neutral-100 p-1 dark:bg-neutral-900">
          {(Object.keys(MODE_LABEL) as Mode[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setMode(value);
                setError(null);
              }}
              aria-pressed={mode === value}
              className={`rounded-md px-2 py-1.5 text-sm ${
                mode === value
                  ? "bg-white font-medium text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100"
                  : "text-neutral-500"
              }`}
            >
              {MODE_LABEL[value]}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="space-y-3">
          <input type="hidden" name="ingredientId" value={row.id} />
          <input type="hidden" name="mode" value={mode} />

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

          {mode === "add" && (
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Best before</span>
              <input
                name="bestBefore"
                type="date"
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              />
              <span className="text-xs text-neutral-500">
                Leave blank to use the shelf life for this ingredient.
              </span>
            </label>
          )}

          <label className="block space-y-1 text-sm">
            <span className="font-medium">Note</span>
            <input
              name="note"
              maxLength={200}
              placeholder={mode === "add" ? "Top-up shop" : mode === "use" ? "Made soup" : "Mouldy"}
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
            disabled={pending}
            className="w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
          >
            {pending ? "Saving…" : SUBMIT_LABEL[mode]}
          </button>
        </form>
      </div>
    </div>
  );
}
