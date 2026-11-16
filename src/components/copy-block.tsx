"use client";

import { useState } from "react";

/**
 * Clipboard writes need a secure context (https or localhost). On a LAN IP the
 * modern API is missing, so fall back to the old selection trick rather than
 * failing silently.
 */
function legacyCopy(text: string): boolean {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "0";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  area.setSelectionRange(0, text.length);

  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }

  document.body.removeChild(area);
  return ok;
}

export function CopyBlock({
  title,
  code,
  language,
  secret,
}: {
  title: string;
  code: string;
  language?: string;
  secret?: boolean;
}) {
  const [revealed, setRevealed] = useState(!secret);
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    let ok = false;

    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(code);
        ok = true;
      } catch {
        ok = legacyCopy(code);
      }
    } else {
      ok = legacyCopy(code);
    }

    setState(ok ? "copied" : "failed");
    if (ok) setTimeout(() => setState("idle"), 1500);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800">
      <div className="flex items-center justify-between gap-2 border-b border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900">
        <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{title}</span>
        <div className="flex items-center gap-3">
          {secret && (
            <button
              type="button"
              onClick={() => setRevealed((value) => !value)}
              className="text-xs text-neutral-500 hover:underline"
            >
              {revealed ? "Hide" : "Reveal"}
            </button>
          )}
          <button
            type="button"
            onClick={copy}
            className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-700 dark:border-neutral-700 dark:text-neutral-300"
          >
            {state === "copied" ? "Copied" : state === "failed" ? "Select it" : "Copy"}
          </button>
        </div>
      </div>
      {state === "failed" && (
        <p className="border-b border-neutral-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-neutral-800 dark:bg-amber-950 dark:text-amber-200">
          Your browser blocked the clipboard. Click the code, select all, and copy manually.
        </p>
      )}
      <pre className="overflow-x-auto px-3 py-3 text-xs leading-relaxed">
        <code className={language === "json" ? "language-json" : undefined}>
          {revealed ? code : "•".repeat(Math.min(code.length, 64))}
        </code>
      </pre>
    </div>
  );
}
