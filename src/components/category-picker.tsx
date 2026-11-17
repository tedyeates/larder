"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Combobox for category names. Mirrors the ingredient picker: type to filter,
 * pick an existing one, or create the typed name. Creation is persisted by the
 * caller (ensureCategory runs when the ingredient is saved).
 */
export function CategoryPicker({
  options,
  value,
  onChange,
  placeholder = "Category",
}: {
  options: readonly string[];
  value: string;
  onChange: (name: string) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

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
      : options.filter((option) => option.toLowerCase().includes(needle));
  const exact = options.some((option) => option.toLowerCase() === needle);
  const canCreate = needle.length > 0 && !exact;

  function choose(name: string) {
    onChange(name);
    setQuery(name);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          onChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && open) {
            event.preventDefault();
            if (matches[0]) choose(matches[0]);
          }
          if (event.key === "Escape") setOpen(false);
        }}
        placeholder={placeholder}
        aria-label="Category"
        autoComplete="off"
        className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
      />

      {open && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-950">
          {matches.length > 0 && (
            <ul className="max-h-48 overflow-y-auto">
              {matches.map((option) => (
                <li key={option}>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(option)}
                    className={`block w-full px-3 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-900 ${
                      option.toLowerCase() === needle ? "font-medium" : ""
                    }`}
                  >
                    {option}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {canCreate && (
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(query.trim())}
              className="block w-full border-t border-neutral-200 px-3 py-2 text-left text-sm text-neutral-600 hover:bg-neutral-100 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-900"
            >
              Create “{query.trim()}”
            </button>
          )}

          {matches.length === 0 && !canCreate && (
            <p className="px-3 py-2 text-sm text-neutral-500">No match.</p>
          )}
        </div>
      )}
    </div>
  );
}
