"use client";

import type { ReactNode } from "react";
import { type PointerEvent as ReactPointerEvent, useRef, useState } from "react";

const ACTION_WIDTH = 88;

/**
 * Swipe a row left to reveal a single action. Works with touch and mouse, keeps
 * the action button in the DOM for keyboard users, and suppresses the click that
 * would otherwise fire at the end of a drag.
 */
export function SwipeToEdit({
  onEdit,
  children,
}: {
  onEdit: () => void;
  children: ReactNode;
}) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; base: number } | null>(null);
  const dragged = useRef(false);

  function down(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    start.current = { x: event.clientX, base: offset };
    dragged.current = false;
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function move(event: ReactPointerEvent<HTMLDivElement>) {
    if (start.current === null) return;
    const delta = event.clientX - start.current.x;
    if (Math.abs(delta) > 6) dragged.current = true;
    setOffset(Math.min(0, Math.max(-ACTION_WIDTH, start.current.base + delta)));
  }

  function up() {
    if (start.current === null) return;
    setOffset(offset < -ACTION_WIDTH / 2 ? -ACTION_WIDTH : 0);
    start.current = null;
    setDragging(false);
  }

  return (
    <div className="relative overflow-hidden">
      <div
        className="absolute inset-y-0 right-0 flex"
        style={{ width: ACTION_WIDTH }}
        aria-hidden={offset === 0}
      >
        <button
          type="button"
          tabIndex={offset === 0 ? -1 : 0}
          onClick={() => {
            setOffset(0);
            onEdit();
          }}
          className="h-full w-full bg-neutral-900 text-xs font-medium text-white dark:bg-white dark:text-neutral-900"
        >
          Edit
        </button>
      </div>

      <div
        className="relative touch-pan-y bg-white dark:bg-neutral-950"
        style={{
          transform: `translateX(${offset}px)`,
          transition: dragging ? "none" : "transform 150ms ease",
        }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onClickCapture={(event) => {
          if (dragged.current) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
