"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type MenuAnchor = {
  left: number;
  top: number;
  width: number;
  above: boolean;
};

/**
 * Where the menu should sit, in page coordinates. The menu is portalled to the
 * body, so it must not be affected by the sheet's scroll position; recomputing
 * this on every frame keeps it glued to the field while the sheet auto-scrolls
 * or the mobile keyboard resizes the viewport.
 */
function anchorFor(element: HTMLElement): MenuAnchor {
  const rect = element.getBoundingClientRect();
  const viewport = window.visualViewport;
  const viewportLeft = viewport?.offsetLeft ?? 0;
  const viewportTop = viewport?.offsetTop ?? 0;
  const viewportWidth = viewport?.width ?? window.innerWidth;
  const viewportHeight = viewport?.height ?? window.innerHeight;
  const margin = 8;

  const width = Math.min(rect.width, viewportWidth - margin * 2);
  const spaceBelow = viewportTop + viewportHeight - rect.bottom - margin;
  const spaceAbove = rect.top - viewportTop - margin;
  const above = spaceBelow < 220 && spaceAbove > spaceBelow;
  const left = Math.min(
    Math.max(rect.left, viewportLeft + margin),
    viewportLeft + viewportWidth - width - margin,
  );

  return {
    left: left + window.scrollX,
    // When flipped, the panel's bottom edge is pinned here.
    top: (above ? rect.top - margin : rect.bottom + margin) + window.scrollY,
    width,
    above,
  };
}

function sameAnchor(a: MenuAnchor, b: MenuAnchor): boolean {
  return (
    a.above === b.above &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5
  );
}

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
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const anchorRef = useRef<MenuAnchor | null>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  function show() {
    const element = inputRef.current;
    if (element) {
      const next = anchorFor(element);
      anchorRef.current = next;
      setAnchor(next);
    }
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

    // Keep the menu attached while the sheet scrolls under it, the keyboard
    // opens, or the browser pans the visual viewport. Reading the rect every
    // frame is cheap and avoids stale coordinates entirely.
    let frame = 0;
    let previous = anchorRef.current;
    function track() {
      const element = inputRef.current;
      if (element) {
        const next = anchorFor(element);
        if (previous === null || !sameAnchor(previous, next)) {
          previous = next;
          anchorRef.current = next;
          setAnchor(next);
        }
      }
      frame = requestAnimationFrame(track);
    }
    frame = requestAnimationFrame(track);

    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", close);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", close);
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
            data-floating-menu=""
            style={{
              position: "absolute",
              left: anchor.left,
              top: anchor.top,
              width: anchor.width,
              zIndex: 60,
              ...(anchor.above ? { transform: "translateY(-100%)" } : null),
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
