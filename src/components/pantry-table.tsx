"use client";

import { useMemo, useState } from "react";
import type { IngredientOption } from "@/lib/catalogue";
import type { PantryRow } from "@/lib/pantry";
import { AddStockSheet } from "./add-stock-sheet";
import { EditIngredientSheet } from "./edit-ingredient-sheet";
import { StockSheet } from "./stock-sheet";
import { SwipeToEdit } from "./swipe-to-edit";

type Filter = "in-stock" | "attention" | "all";

function chipClass(row: PantryRow): string {
  if (row.status === "Out") return "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300";
  if (row.status === "Use soon")
    return "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300";
  if (row.status === "Low")
    return "bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300";
  return "bg-neutral-100 text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400";
}

function matchesFilter(row: PantryRow, filter: Filter): boolean {
  if (filter === "all") return true;
  // The pantry is stock, not catalogue: zero-quantity rows are opt-in.
  if (filter === "in-stock") return row.onHand > 0;
  // "Running out" means low now, or ran out recently — not everything you have
  // never bought.
  return row.status === "Low" || row.useSoon || row.expired || row.recentlyRanOut;
}

export function PantryTable({
  rows,
  ingredients,
}: {
  rows: readonly PantryRow[];
  ingredients: readonly IngredientOption[];
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("in-stock");
  const [selected, setSelected] = useState<PantryRow | null>(null);
  const [editing, setEditing] = useState<PantryRow | null>(null);
  const [adding, setAdding] = useState(false);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter(
      (row) =>
        matchesFilter(row, filter) && (needle === "" || row.name.toLowerCase().includes(needle)),
    );
  }, [rows, query, filter]);

  const groups = useMemo(() => {
    const byCategory = new Map<string, { label: string; sortOrder: number; rows: PantryRow[] }>();
    for (const row of visible) {
      const existing = byCategory.get(row.categoryId);
      if (existing) {
        existing.rows.push(row);
      } else {
        byCategory.set(row.categoryId, {
          label: row.category,
          sortOrder: row.categorySortOrder,
          rows: [row],
        });
      }
    }
    return [...byCategory.entries()]
      .sort(
        (a, b) => a[1].sortOrder - b[1].sortOrder || a[1].label.localeCompare(b[1].label),
      )
      .map(([category, group]) => ({ category, label: group.label, rows: group.rows }));
  }, [visible]);

  const inStock = rows.filter((row) => row.onHand > 0).length;
  const attention = rows.filter(
    (row) => row.status === "Low" || row.useSoon || row.expired || row.recentlyRanOut,
  ).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search ingredients"
            aria-label="Search ingredients"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 sm:max-w-xs dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-100"
          />
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="shrink-0 rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
          >
            + Add item
          </button>
        </div>

        <div
          className="flex gap-1 rounded-lg bg-neutral-100 p-1 dark:bg-neutral-900"
          role="tablist"
        >
          {(
            [
              ["in-stock", "In stock"],
              ["attention", "Running out"],
              ["all", "All"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={filter === value}
              onClick={() => setFilter(value)}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm whitespace-nowrap ${
                filter === value
                  ? "bg-white font-medium text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100"
                  : "text-neutral-500"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <p className="text-sm text-neutral-500">
        {inStock} in stock · {attention} need attention · {visible.length} shown
      </p>

      {groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 px-6 py-10 text-center dark:border-neutral-700">
          <p className="text-sm text-neutral-500">
            {filter === "in-stock" && query.trim() === ""
              ? "Nothing in the pantry yet."
              : filter === "attention" && query.trim() === ""
                ? "Nothing is running low or ran out this week."
                : "Nothing matches. Clear the search or switch filters."}
          </p>
          {filter === "in-stock" && (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
              >
                + Add an item
              </button>
              <button
                type="button"
                onClick={() => setFilter("all")}
                className="text-sm text-neutral-600 underline underline-offset-4 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
              >
                Show all {rows.length} ingredients
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.category} className="space-y-1">
              <h2 className="px-1 text-xs font-medium tracking-wide text-neutral-500 uppercase">
                {group.label}
              </h2>
              <ul className="divide-y divide-neutral-200 overflow-hidden rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
                {group.rows.map((row) => (
                  <li key={row.id}>
                    <SwipeToEdit onEdit={() => setEditing(row)}>
                      <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{row.name}</p>
                          <p className="text-xs text-neutral-500">
                            {row.onHand <= 0
                              ? row.ranOutLabel === null
                                ? "Not in stock"
                                : `Ran out ${row.ranOutLabel}`
                              : row.useBy === null
                                ? "No use-by"
                                : `Use by ${row.useBy}`}
                            {row.expired ? " · expired" : ""}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:flex-nowrap sm:gap-3">
                          <span className="text-sm tabular-nums">{row.display}</span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${chipClass(row)}`}
                          >
                            {row.status}
                          </span>
                          {row.low && row.status !== "Low" && (
                            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">
                              low
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => setSelected(row)}
                            aria-label={`Adjust ${row.name}`}
                            className="ml-auto rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:border-neutral-500 hover:text-neutral-900 sm:ml-0 dark:border-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-100"
                          >
                            Adjust
                          </button>
                        </div>
                      </div>
                    </SwipeToEdit>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {selected !== null && <StockSheet row={selected} onClose={() => setSelected(null)} />}
      {editing !== null && (
        <EditIngredientSheet
          row={editing}
          categories={[...new Set(ingredients.map((item) => item.category))].sort((a, b) =>
            a.localeCompare(b),
          )}
          onClose={() => setEditing(null)}
        />
      )}
      {adding && (
        <AddStockSheet ingredients={ingredients} onClose={() => setAdding(false)} />
      )}
    </div>
  );
}
