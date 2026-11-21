"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { syncTickTickAction } from "@/actions/ticktick";

export function TickTickSyncBar({
  connected,
  configured,
  projectName,
  lastSyncedAt,
}: {
  connected: boolean;
  configured: boolean;
  projectName: string | null;
  lastSyncedAt: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function sync() {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await syncTickTickAction();
      setMessage(result.message ?? null);
      setError(result.error ?? null);
      router.refresh();
    });
  }

  return (
    <div className="mb-5 rounded-xl border border-neutral-200 px-3 py-2.5 dark:border-neutral-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {configured ? `TickTick · ${projectName ?? "list"}` : "TickTick"}
          </p>
          <p className="truncate text-xs text-neutral-500">
            {configured
              ? lastSyncedAt
                ? `Last sync ${new Date(lastSyncedAt).toLocaleString("en-GB")}`
                : "Ready to sync"
              : connected
                ? "Choose a TickTick list to finish setup."
                : "Send this list to TickTick and bring bought items back."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/settings/ticktick"
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-600 dark:border-neutral-700 dark:text-neutral-300"
          >
            {configured ? "Settings" : "Set up"}
          </Link>
          {configured && (
            <button
              type="button"
              onClick={sync}
              disabled={pending}
              className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
            >
              {pending ? "Syncing…" : "Sync now"}
            </button>
          )}
        </div>
      </div>
      {(message !== null || error !== null) && (
        <p
          className={`mt-2 text-xs ${error ? "text-red-600 dark:text-red-400" : "text-neutral-500"}`}
        >
          {error ?? message}
        </p>
      )}
    </div>
  );
}
