"use client";

import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useRef, useState } from "react";

const ACTION_WIDTH = 72;

export interface SwipeAction {
  readonly key: string;
  readonly label: string;
  readonly icon: ReactNode;
  readonly onClick: () => void;
  readonly tone?: "primary" | "secondary";
}

/**
 * Swipe a row left to reveal its actions, TickTick style. Works with touch and
 * mouse, keeps the buttons in the DOM for keyboard users, and only captures the
 * pointer once the gesture is clearly horizontal so taps still click normally.
 */
export function SwipeActions({
  actions,
  children,
}: {
  actions: readonly SwipeAction[];
  children: ReactNode;
}) {
  const panelWidth = actions.length * ACTION_WIDTH;
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; base: number } | null>(null);
  const dragged = useRef(false);
  const capturing = useRef(false);

  function down(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    start.current = { x: event.clientX, base: offset };
    dragged.current = false;
    capturing.current = false;
    setDragging(true);
  }

  function move(event: ReactPointerEvent<HTMLDivElement>) {
    if (start.current === null) return;
    const delta = event.clientX - start.current.x;

    if (!capturing.current && Math.abs(delta) > 8) {
      capturing.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (!capturing.current) return;

    dragged.current = true;
    setOffset(Math.min(0, Math.max(-panelWidth, start.current.base + delta)));
  }

  function up(event: ReactPointerEvent<HTMLDivElement>) {
    if (start.current === null) return;
    if (capturing.current) {
      event.currentTarget.releasePointerCapture(event.pointerId);
      capturing.current = false;
    }
    if (dragged.current) {
      setOffset(offset < -panelWidth / 2 ? -panelWidth : 0);
    }
    start.current = null;
    setDragging(false);
  }

  return (
    <div className="relative overflow-hidden">
      <div
        className="absolute inset-y-0 right-0 flex"
        style={{ width: panelWidth }}
        aria-hidden={offset === 0}
      >
        {actions.map((action) => (
          <button
            key={action.key}
            type="button"
            tabIndex={offset === 0 ? -1 : 0}
            onClick={() => {
              setOffset(0);
              action.onClick();
            }}
            className={`flex w-full flex-col items-center justify-center gap-1 text-[10px] font-medium ${
              action.tone === "primary"
                ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                : "bg-neutral-200 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100"
            }`}
          >
            {action.icon}
            {action.label}
          </button>
        ))}
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
            return;
          }
          if (offset !== 0) {
            event.preventDefault();
            event.stopPropagation();
            setOffset(0);
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
