"use client";

import { useMemo, useState } from "react";
import type { PantryRow } from "@/lib/pantry";
import { StockSheet } from "./stock-sheet";

const CATEGORY_ORDER = [
  "produce",
  "dairy",
  "meat",
  "fish",
  "bakery",
  "dry",
  "frozen",
  "tins",
  "drinks",
  "other",
] as const;

const CATEGORY_LABEL: Record<string, string> = {
  produce: "Produce",
  dairy: "Dairy",
  meat: "Meat",
  fish: "Fish",
  bakery: "Bakery",
  dry: "Dry goods",
  frozen: "Frozen",
  tins: "Tins",
  drinks: "Drinks",
  other: "Other",
};

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
  return row.onHand <= 0 || row.status === "Low" || row.useSoon || row.expired;
}

export function PantryTable({ rows }: { rows: readonly PantryRow[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("in-stock");
  const [selected, setSelected] = useState<PantryRow | null>(null);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter(
      (row) =>
        matchesFilter(row, filter) && (needle === "" || row.name.toLowerCase().includes(needle)),
    );
  }, [rows, query, filter]);

  const groups = useMemo(() => {
    const byCategory = new Map<string, PantryRow[]>();
    for (const row of visible) {
      const list = byCategory.get(row.category) ?? [];
      list.push(row);
      byCategory.set(row.category, list);
    }
    return CATEGORY_ORDER.filter((category) => byCategory.has(category)).map((category) => ({
      category,
      label: CATEGORY_LABEL[category] ?? category,
      rows: byCategory.get(category) ?? [],
    }));
  }, [visible]);

  const inStock = rows.filter((row) => row.onHand > 0).length;
  const attention = rows.filter(
    (row) => row.onHand <= 0 || row.status === "Low" || row.useSoon || row.expired,
  ).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search ingredients"
          aria-label="Search ingredients"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 sm:max-w-xs dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-100"
        />

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
              : "Nothing matches. Clear the search or switch filters."}
          </p>
          {filter === "in-stock" && (
            <button
              type="button"
              onClick={() => setFilter("all")}
              className="mt-3 text-sm text-neutral-600 underline underline-offset-4 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
            >
              Show all {rows.length} ingredients
            </button>
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
                  <li key={row.id} className="flex items-center justify-between gap-4 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{row.name}</p>
                      <p className="text-xs text-neutral-500">
                        {row.useBy === null ? "No use-by" : `Use by ${row.useBy}`}
                        {row.expired ? " · expired" : ""}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-3">
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
                        className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:border-neutral-500 hover:text-neutral-900 dark:border-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-100"
                      >
                        Adjust
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {selected !== null && <StockSheet row={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
