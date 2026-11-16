"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cookEntry } from "@/actions/cook";
import {
  activatePlan,
  addLeftoverToPlan,
  addPlannedLeftover,
  addRecipeToPlan,
  discardDraft,
  removePlanEntry,
} from "@/actions/plan";
import { generateShoppingList } from "@/actions/shop";
import type { LeftoverOption, PlanEntryView, RecipeOption, Slot } from "@/lib/plan";

const DAY_LABEL = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

function dayLabel(day: string): string {
  return DAY_LABEL.format(new Date(`${day}T00:00:00Z`));
}

export function WeekBoard({
  week,
  days,
  status,
  entries,
  recipes,
  leftovers,
}: {
  week: string;
  days: readonly string[];
  status: "draft" | "active" | "archived";
  entries: readonly PlanEntryView[];
  recipes: readonly RecipeOption[];
  leftovers: readonly LeftoverOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ day: string; slot: Slot } | null>(null);
  const [kind, setKind] = useState<"recipe" | "leftover">("recipe");
  const [recipeId, setRecipeId] = useState(recipes[0]?.id ?? "");
  const [leftoverChoice, setLeftoverChoice] = useState(
    leftovers[0] ? `batch:${leftovers[0].id}` : recipes[0] ? `planned:${recipes[0].id}` : "",
  );
  const [portions, setPortions] = useState("2");

  function openAdd(day: string, slot: Slot) {
    setAdding({ day, slot });
    setKind(recipes.length > 0 ? "recipe" : "leftover");
    setRecipeId(recipes[0]?.id ?? "");
    setLeftoverChoice(
      leftovers[0] ? `batch:${leftovers[0].id}` : recipes[0] ? `planned:${recipes[0].id}` : "",
    );
    setPortions("2");
    setMessage(null);
  }

  function submitAdd() {
    if (!adding) return;
    startTransition(async () => {
      const result =
        kind === "recipe"
          ? await addRecipeToPlan({
              week,
              day: adding.day,
              slot: adding.slot,
              recipeId,
              portions: Number(portions),
            })
          : leftoverChoice.startsWith("batch:")
            ? await addLeftoverToPlan({
                week,
                day: adding.day,
                slot: adding.slot,
                leftoverId: leftoverChoice.slice("batch:".length),
                portions: Number(portions),
              })
            : await addPlannedLeftover({
                week,
                day: adding.day,
                slot: adding.slot,
                recipeId: leftoverChoice.slice("planned:".length),
                portions: Number(portions),
              });

      setMessage(result.error ?? result.message ?? null);
      if (!result.error) setAdding(null);
      router.refresh();
    });
  }

  function cook(entry: PlanEntryView) {
    startTransition(async () => {
      const result = await cookEntry({
        entryId: entry.id,
        eatenNow: entry.kind === "leftover" ? entry.portions : 1,
      });
      setMessage(result.error ?? result.message ?? null);
      router.refresh();
    });
  }

  function remove(entry: PlanEntryView) {
    startTransition(async () => {
      const result = await removePlanEntry(entry.id);
      setMessage(result.error ?? result.message ?? null);
      router.refresh();
    });
  }

  function generate() {
    startTransition(async () => {
      const result = await generateShoppingList(week);
      setMessage(result.error ?? result.message ?? null);
      router.refresh();
    });
  }

  function settleDraft(action: "activate" | "discard") {
    startTransition(async () => {
      const result = action === "activate" ? await activatePlan(week) : await discardDraft(week);
      setMessage(result.error ?? result.message ?? null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {status === "draft" && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950">
          <p className="font-medium">Draft from an agent</p>
          <p className="mt-1 text-amber-900 dark:text-amber-200">
            Nothing here is confirmed. Activate to keep it, or discard to remove the agent&apos;s
            entries. Your own meals are always kept.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => settleDraft("activate")}
              disabled={pending}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
            >
              Activate
            </button>
            <button
              type="button"
              onClick={() => settleDraft("discard")}
              disabled={pending}
              className="rounded-md border border-amber-400 px-3 py-1.5 text-xs text-amber-900 disabled:opacity-50 dark:border-amber-700 dark:text-amber-200"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-neutral-500">
          {entries.length} meal(s) planned · {leftovers.length} leftover(s) waiting
        </p>
        <button
          type="button"
          onClick={generate}
          disabled={pending}
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-neutral-700"
        >
          Generate shopping list
        </button>
      </div>

      {message !== null && (
        <p className="rounded-lg bg-neutral-100 px-3 py-2 text-sm dark:bg-neutral-900">{message}</p>
      )}

      <div className="space-y-5">
        {days.map((day) => (
          <section key={day} className="space-y-2">
            <h2 className="text-xs font-medium tracking-wide text-neutral-500 uppercase">
              {dayLabel(day)}
            </h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {(["lunch", "dinner"] as const).map((slot) => {
                const entry = entries.find((row) => row.day === day && row.slot === slot);
                return (
                  <div
                    key={slot}
                    className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800"
                  >
                    <p className="mb-1 text-xs text-neutral-500 capitalize">{slot}</p>

                    {entry === undefined ? (
                      <button
                        type="button"
                        onClick={() => openAdd(day, slot)}
                        className="w-full rounded-lg border border-dashed border-neutral-300 py-2 text-sm text-neutral-500 hover:border-neutral-500 dark:border-neutral-700"
                      >
                        + Add meal
                      </button>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium">
                            {entry.title}
                            <span className="ml-2 text-xs font-normal text-neutral-500">
                              {entry.portions} portion(s)
                            </span>
                          </p>
                          {entry.kind === "leftover" && (
                            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">
                              {entry.leftoverId === null ? "planned leftover" : "leftover"}
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {entry.status === "planned" && (
                            <button
                              type="button"
                              onClick={() => cook(entry)}
                              disabled={pending}
                              className="rounded-md bg-neutral-900 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
                            >
                              {entry.kind === "leftover" ? "Eat" : "Cook"}
                            </button>
                          )}
                          {entry.status !== "planned" && (
                            <span className="text-xs text-neutral-500 capitalize">
                              {entry.status}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => remove(entry)}
                            disabled={pending}
                            className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-500 disabled:opacity-50 dark:border-neutral-700"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {adding !== null && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Add a meal"
            className="w-full max-w-md space-y-4 rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl dark:bg-neutral-950"
          >
            <div className="flex items-start justify-between">
              <h2 className="text-lg font-semibold">
                {dayLabel(adding.day)} · {adding.slot}
              </h2>
              <button
                type="button"
                onClick={() => setAdding(null)}
                className="text-sm text-neutral-500 hover:underline"
              >
                Close
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1 rounded-lg bg-neutral-100 p-1 dark:bg-neutral-900">
              {(["recipe", "leftover"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setKind(value)}
                  aria-pressed={kind === value}
                  className={`rounded-md px-2 py-1.5 text-sm capitalize ${
                    kind === value
                      ? "bg-white font-medium shadow-sm dark:bg-neutral-800"
                      : "text-neutral-500"
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>

            {kind === "recipe" ? (
              recipes.length === 0 ? (
                <p className="text-sm text-neutral-500">
                  No recipes yet. Add one on the Recipes tab first.
                </p>
              ) : (
                <label className="block space-y-1 text-sm">
                  <span className="font-medium">Recipe</span>
                  <select
                    value={recipeId}
                    onChange={(event) => setRecipeId(event.target.value)}
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
                  >
                    {recipes.map((recipe) => (
                      <option key={recipe.id} value={recipe.id}>
                        {recipe.title} ({recipe.servings} servings)
                      </option>
                    ))}
                  </select>
                </label>
              )
            ) : leftovers.length === 0 && recipes.length === 0 ? (
              <p className="text-sm text-neutral-500">
                Nothing to draw on yet. Cook something, or add a recipe first.
              </p>
            ) : (
              <label className="block space-y-1 text-sm">
                <span className="font-medium">Leftovers from</span>
                <select
                  value={leftoverChoice}
                  onChange={(event) => setLeftoverChoice(event.target.value)}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
                >
                  {leftovers.length > 0 && (
                    <optgroup label="Already cooked">
                      {leftovers.map((batch) => (
                        <option key={batch.id} value={`batch:${batch.id}`}>
                          {batch.label} ({batch.portions} left)
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {recipes.length > 0 && (
                    <optgroup label="From a dish you'll cook">
                      {recipes.map((recipe) => (
                        <option key={recipe.id} value={`planned:${recipe.id}`}>
                          {recipe.title}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <span className="block text-xs text-neutral-500">
                  Planning ahead is fine — the pantry only changes when you actually cook.
                </span>
              </label>
            )}

            <label className="block space-y-1 text-sm">
              <span className="font-medium">Portions</span>
              <input
                type="number"
                min="0.5"
                step="0.5"
                value={portions}
                onChange={(event) => setPortions(event.target.value)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
              />
            </label>

            <button
              type="button"
              onClick={submitAdd}
              disabled={pending || (kind === "recipe" ? recipeId === "" : leftoverChoice === "")}
              className="w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
            >
              {pending ? "Adding…" : "Add to plan"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
