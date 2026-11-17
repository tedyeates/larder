"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createIngredient } from "@/actions/ingredients";
import type { UnitCode } from "@/domain/units";
import type { IngredientOption } from "@/lib/catalogue";
import { CREATE_UNITS } from "@/lib/ingredient-options";

/**
 * Searchable ingredient picker with inline creation. Typing filters by name
 * and aliases; if nothing matches exactly, the same input creates the item in
 * the catalogue, so a new recipe never dead-ends on a missing ingredient.
 */
export function IngredientPicker({
  options,
  value,
  onSelect,
  disabled,
}: {
  options: readonly IngredientOption[];
  value: string;
  onSelect: (option: IngredientOption) => void;
  disabled?: boolean;
}) {
  const selected = options.find((option) => option.id === value) ?? null;
  const [query, setQuery] = useState(selected?.name ?? "");
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [unit, setUnit] = useState<UnitCode>(selected?.stockUnit ?? "g");
  const [category, setCategory] = useState("Other");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(selected?.name ?? "");
  }, [selected?.name]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const node = event.target as Node | null;
      if (containerRef.current && node && !containerRef.current.contains(node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const needle = query.trim().toLowerCase();
  const matches =
    needle === ""
      ? options
      : options.filter(
          (option) =>
            option.name.toLowerCase().includes(needle) ||
            option.aliases.some((alias) => alias.toLowerCase().includes(needle)),
        );
  const exact = options.some((option) => option.name.toLowerCase() === needle);
  const canCreate = needle.length > 1 && !exact;

  function choose(option: IngredientOption) {
    onSelect(option);
    setQuery(option.name);
    setUnit(option.stockUnit);
    setOpen(false);
    setCreating(false);
    setError(null);
  }

  function create() {
    startTransition(async () => {
      const result = await createIngredient({
        name: query.trim(),
        category,
        stockUnit: unit,
      });
      if (result.error !== undefined || result.ingredient === undefined) {
        setError(result.error ?? "Could not create that ingredient.");
        return;
      }
      onSelect({ ...result.ingredient, aliases: result.ingredient.aliases });
      setQuery(result.ingredient.name);
      setOpen(false);
      setCreating(false);
      setError(null);
    });
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        value={query}
        disabled={disabled}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setCreating(false);
          setError(null);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && open) {
            event.preventDefault();
            if (matches[0]) choose(matches[0]);
          }
          if (event.key === "Escape") setOpen(false);
        }}
        placeholder="Search ingredients"
        aria-label="Ingredient"
        autoComplete="off"
        className="w-full rounded-lg border border-neutral-300 px-2 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
      />

      {open && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-950">
          {matches.length > 0 && (
            <ul className="max-h-56 overflow-y-auto">
              {matches.slice(0, 40).map((option) => (
                <li key={option.id}>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(option)}
                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-900 ${
                      option.id === value ? "font-medium" : ""
                    }`}
                  >
                    <span className="truncate">{option.name}</span>
                    <span className="ml-2 text-xs text-neutral-400">{option.stockUnit}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {canCreate && !creating && (
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setCreating(true);
                setError(null);
              }}
              className="block w-full border-t border-neutral-200 px-3 py-2 text-left text-sm text-neutral-600 hover:bg-neutral-100 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-900"
            >
              Create “{query.trim()}”
            </button>
          )}

          {canCreate && creating && (
            <div className="space-y-2 border-t border-neutral-200 p-3 dark:border-neutral-800">
              <p className="text-xs text-neutral-500">
                New ingredient: <span className="font-medium">{query.trim()}</span>
              </p>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1 text-xs">
                  <span className="text-neutral-500">Count it in</span>
                  <select
                    value={unit}
                    onChange={(event) => setUnit(event.target.value as UnitCode)}
                    className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                  >
                    {CREATE_UNITS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-xs">
                  <span className="text-neutral-500">Category</span>
                  <input
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                    list="larder-categories"
                    placeholder="Category"
                    className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                  />
                  <datalist id="larder-categories">
                    {[...new Set(options.map((option) => option.category))]
                      .sort((a, b) => a.localeCompare(b))
                      .map((option) => (
                        <option key={option} value={option} />
                      ))}
                  </datalist>
                </label>
              </div>
              {error !== null && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
              <button
                type="button"
                onClick={create}
                disabled={pending}
                className="w-full rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
              >
                {pending ? "Creating…" : "Create and use"}
              </button>
            </div>
          )}

          {matches.length === 0 && !canCreate && (
            <p className="px-3 py-2 text-sm text-neutral-500">No match.</p>
          )}
        </div>
      )}
    </div>
  );
}
