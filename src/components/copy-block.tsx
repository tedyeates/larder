"use client";

import { useState } from "react";

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
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
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
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      <pre className="overflow-x-auto px-3 py-3 text-xs leading-relaxed">
        <code className={language === "json" ? "language-json" : undefined}>
          {revealed ? code : "•".repeat(Math.min(code.length, 64))}
        </code>
      </pre>
    </div>
  );
}
