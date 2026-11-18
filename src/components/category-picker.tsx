"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Combobox for category names. The menu renders in a portal so it is never
 * clipped by a scrolling sheet, and flips above the field when there is no room
 * below. Typing a new name offers "Create", which the caller persists when the
 * ingredient is saved.
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
  const [anchor, setAnchor] = useState<{
    left: number;
    width: number;
    top: number;
    above: boolean;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  function measure() {
    const element = inputRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const above = spaceBelow < 220 && rect.top > spaceBelow;
    setAnchor({
      left: rect.left,
      width: rect.width,
      // When flipped, `top` is the distance from the viewport bottom.
      top: above ? window.innerHeight - rect.top + 6 : rect.bottom + 6,
      above,
    });
  }

  function show() {
    measure();
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      const node = event.target as Node | null;
      if (!node) return;
      if (containerRef.current?.contains(node)) return;
      if (panelRef.current?.contains(node)) return;
      setOpen(false);
    }

    function close() {
      setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close);
    };
  }, [open]);

  const needle = query.trim().toLowerCase();
  const matches =
    needle === "" ? options : options.filter((option) => option.toLowerCase().includes(needle));
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
        ref={inputRef}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          onChange(event.target.value);
          if (!open) show();
        }}
        onFocus={show}
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

      {open &&
        anchor !== null &&
        createPortal(
          <div
            ref={panelRef}
            style={{
              position: "fixed",
              left: anchor.left,
              width: anchor.width,
              zIndex: 60,
              ...(anchor.above ? { bottom: anchor.top } : { top: anchor.top }),
            }}
            className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-950"
          >
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
          </div>,
          document.body,
        )}
    </div>
  );
}
