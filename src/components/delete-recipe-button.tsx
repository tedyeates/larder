"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteRecipe } from "@/actions/recipes";

export function DeleteRecipeButton({ recipeId, title }: { recipeId: string; title: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
      >
        Delete
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            startTransition(async () => {
              const result = await deleteRecipe(recipeId);
              if (result.error) {
                setError(result.error);
                setConfirming(false);
                return;
              }
              router.push("/recipes");
              router.refresh();
            });
          }}
          className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Deleting…" : `Delete “${title}”`}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-500 dark:border-neutral-700"
        >
          Cancel
        </button>
      </div>
      {error !== null && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
