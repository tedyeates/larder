"use client";

import { useEffect } from "react";

/**
 * Keep the phone awake while a recipe is open, so the screen does not lock
 * mid-step. Browsers drop the lock when the tab is hidden; re-request it when
 * the recipe comes back into view. Unsupported browsers simply do nothing.
 */
export function KeepScreenAwake() {
  useEffect(() => {
    // `wakeLock` is in the DOM types but absent on older browsers.
    const wakeLock = (navigator as unknown as { wakeLock?: WakeLock }).wakeLock;
    if (!wakeLock) return;
    const lockApi = wakeLock;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    async function acquire() {
      if (cancelled || sentinel !== null || document.visibilityState !== "visible") return;
      try {
        const lock = await lockApi.request("screen");
        if (cancelled) {
          await lock.release();
          return;
        }
        sentinel = lock;
        sentinel.addEventListener("release", () => {
          sentinel = null;
        });
      } catch {
        // Low battery, permissions, or a browser that exposes the API but
        // refuses the lock. The recipe still works; the screen may sleep.
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") void acquire();
    }

    function onInteraction() {
      void acquire();
    }

    void acquire();
    document.addEventListener("visibilitychange", onVisibilityChange);
    document.addEventListener("pointerdown", onInteraction);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      document.removeEventListener("pointerdown", onInteraction);
      void sentinel?.release();
      sentinel = null;
    };
  }, []);

  return null;
}
