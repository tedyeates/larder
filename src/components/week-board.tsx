"use client";

import { Flame, Trash2, Utensils } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cookEntry } from "@/actions/cook";
import {
  activatePlan,
  addLeftoverToPlan,
  addPlannedLeftover,
  addRecipeToPlan,
  discardDraft,
  discardLeftover,
  removePlanEntry,
} from "@/actions/plan";
import { generateShoppingList } from "@/actions/shop";
import type {
  LeftoverOption,
  PlanEntryView,
  PlannedCook,
  PlanSummary,
  RecipeOption,
  Slot,
} from "@/lib/plan";
import { type SwipeAction, SwipeActions } from "./swipe-actions";

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
  plannedCooks,
  summary,
}: {
  week: string;
  days: readonly string[];
  status: "draft" | "active" | "archived";
  entries: readonly PlanEntryView[];
  recipes: readonly RecipeOption[];
  leftovers: readonly LeftoverOption[];
  plannedCooks: readonly PlannedCook[];
  summary: PlanSummary;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ day: string; slot: Slot } | null>(null);
  const [kind, setKind] = useState<"recipe" | "leftover">("recipe");
  const [recipeId, setRecipeId] = useState(recipes[0]?.id ?? "");
  const [leftoverChoice, setLeftoverChoice] = useState("");
  const [portions, setPortions] = useState("2");

  function servingsFor(id: string): number {
    return recipes.find((recipe) => recipe.id === id)?.servings ?? 2;
  }

  function chooseKind(value: "recipe" | "leftover") {
    setKind(value);
    if (value === "recipe") {
      setPortions(String(servingsFor(recipeId)));
      return;
    }
    const choice = leftoverChoice || defaultChoice();
    setLeftoverChoice(choice);
    const available = availableFor(choice);
    setPortions(available > 0 ? String(Math.min(1, available)) : "");
  }

  function availableFor(choice: string): number {
    if (choice.startsWith("batch:")) {
      const batch = leftovers.find((item) => `batch:${item.id}` === choice);
      return batch?.portions ?? 0;
    }
    if (choice.startsWith("planned:")) {
      const cook = plannedCooks.find((item) => `planned:${item.recipeId}` === choice);
      return cook ? cook.capacity - cook.reserved : 0;
    }
    return 0;
  }

  function defaultChoice(): string {
    if (leftovers[0]) return `batch:${leftovers[0].id}`;
    const cook = plannedCooks.find((item) => item.capacity - item.reserved > 0);
    return cook ? `planned:${cook.recipeId}` : "";
  }

  function chooseLeftover(choice: string) {
    setLeftoverChoice(choice);
    const available = availableFor(choice);
    setPortions(available > 0 ? String(Math.min(1, available)) : "");
  }

  function openAdd(day: string, slot: Slot) {
    setAdding({ day, slot });
    setKind(recipes.length > 0 ? "recipe" : "leftover");
    setRecipeId(recipes[0]?.id ?? "");
    const choice = defaultChoice();
    setLeftoverChoice(choice);
    if (recipes[0]) {
      setPortions(String(recipes[0].servings));
    } else {
      const available = availableFor(choice);
      setPortions(available > 0 ? String(Math.min(1, available)) : "");
    }
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

  function discardBatch(leftoverId: string) {
    startTransition(async () => {
      const result = await discardLeftover(leftoverId);
      setMessage(result.error ?? result.message ?? null);
      router.refresh();
    });
  }

  function renderEntry(entry: PlanEntryView) {
    const actions: SwipeAction[] = [];

    if (entry.status === "planned" && (entry.kind !== "leftover" || entry.leftoverId !== null)) {
      actions.push({
        key: "cook",
        label: entry.kind === "leftover" ? "Eat" : "Cook",
        icon: entry.kind === "leftover" ? <Utensils size={15} /> : <Flame size={15} />,
        onClick: () => cook(entry),
        tone: "primary",
      });
    }

    actions.push({
      key: "remove",
      label: "Remove",
      icon: <Trash2 size={15} />,
      onClick: () => remove(entry),
    });

    return (
      <SwipeActions actions={actions}>
        <div className="space-y-1 py-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium">
              {entry.recipeId ? (
                <Link
                  href={`/recipes/${entry.recipeId}`}
                  className="underline decoration-neutral-300 underline-offset-4 hover:decoration-neutral-500"
                >
                  {entry.title}
                </Link>
              ) : (
                entry.title
              )}
              <span className="ml-2 text-xs font-normal text-neutral-500">
                {entry.portions} {entry.kind === "leftover" ? "portion(s)" : "serving(s)"}
              </span>
            </p>
            {entry.kind === "leftover" && (
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">
                {entry.leftoverId === null ? "planned leftover" : "leftover"}
              </span>
            )}
          </div>

          {entry.status === "planned" && entry.kind === "leftover" && entry.leftoverId === null && (
            <span className="block text-xs text-neutral-500">waiting for the cook</span>
          )}
          {entry.status !== "planned" && (
            <span className="block text-xs text-neutral-500 capitalize">{entry.status}</span>
          )}
        </div>
      </SwipeActions>
    );
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
        <div className="space-y-0.5">
          <p className="text-sm text-neutral-500">
            {summary.cooks} dish(es) to cook · {summary.leftoverMeals} leftover meal(s)
          </p>
          <p className="text-xs text-neutral-500">
            {summary.sparePortions > 0
              ? `${summary.sparePortions} spare portion(s) from planned cooks`
              : "No spare portions from planned cooks"}
            {leftovers.length > 0 ? ` · ${leftovers.length} in the fridge` : ""}
          </p>
        </div>
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

      {leftovers.length > 0 && (
        <section className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
          <h2 className="text-xs font-medium tracking-wide text-neutral-500 uppercase">
            Leftovers in the fridge
          </h2>
          <ul className="mt-2 divide-y divide-neutral-200 dark:divide-neutral-800">
            {leftovers.map((batch) => (
              <li key={batch.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{batch.label}</p>
                  <p className="text-xs text-neutral-500">
                    {batch.portions} portion(s)
                    {batch.bestBefore === null ? "" : ` · use by ${batch.bestBefore}`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => discardBatch(batch.id)}
                  disabled={pending}
                  className="shrink-0 rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-500 disabled:opacity-50 dark:border-neutral-700"
                >
                  Discard
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="space-y-5">
        {days.map((day) => (
          <section key={day} className="space-y-2">
            <h2 className="text-xs font-medium tracking-wide text-neutral-500 uppercase">
              {dayLabel(day)}
            </h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {(["lunch", "dinner"] as const).map((slot) => {
                const slotEntries = entries.filter((row) => row.day === day && row.slot === slot);
                return (
                  <div
                    key={slot}
                    className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800"
                  >
                    <p className="mb-1 text-xs text-neutral-500 capitalize">
                      {slot}
                      {slotEntries.length > 1 ? ` · ${slotEntries.length} dishes` : ""}
                    </p>

                    {slotEntries.length === 0 ? (
                      <button
                        type="button"
                        onClick={() => openAdd(day, slot)}
                        className="w-full rounded-lg border border-dashed border-neutral-300 py-2 text-sm text-neutral-500 hover:border-neutral-500 dark:border-neutral-700"
                      >
                        + Add meal
                      </button>
                    ) : (
                      <div className="space-y-2">
                        <div className="space-y-2 divide-y divide-neutral-200 dark:divide-neutral-800">
                          {slotEntries.map((entry) => (
                            <div key={entry.id} className="pt-2 first:pt-0">
                              {renderEntry(entry)}
                            </div>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => openAdd(day, slot)}
                          className="w-full rounded-lg border border-dashed border-neutral-300 py-1.5 text-xs text-neutral-500 hover:border-neutral-500 dark:border-neutral-700"
                        >
                          + Add another dish
                        </button>
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
            className="max-h-[90dvh] w-full max-w-md space-y-4 overflow-y-auto rounded-t-2xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-xl sm:rounded-2xl sm:pb-5 dark:bg-neutral-950"
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
                  onClick={() => chooseKind(value)}
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
                    onChange={(event) => {
                      setRecipeId(event.target.value);
                      setPortions(String(servingsFor(event.target.value)));
                    }}
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
            ) : leftovers.length === 0 &&
              plannedCooks.every((cook) => cook.capacity - cook.reserved <= 0) ? (
              <p className="text-sm text-neutral-500">
                Nothing to draw on yet. Add the meal first — one portion is eaten on the night, and
                the rest can be scheduled.
              </p>
            ) : (
              <label className="block space-y-1 text-sm">
                <span className="font-medium">Leftovers from</span>
                <select
                  value={leftoverChoice}
                  onChange={(event) => chooseLeftover(event.target.value)}
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
                  {plannedCooks
                    .filter((cook) => cook.capacity - cook.reserved > 0)
                    .map((cook) => (
                      <option key={cook.recipeId} value={`planned:${cook.recipeId}`}>
                        {cook.title} — {cook.capacity - cook.reserved} spare of {cook.portions} (
                        {dayLabel(cook.day)})
                      </option>
                    ))}
                </select>
                <span className="block text-xs text-neutral-500">
                  {availableFor(leftoverChoice) > 0
                    ? `${availableFor(leftoverChoice)} portion(s) available here.`
                    : "Cook the dish first, or pick another source."}
                </span>
              </label>
            )}

            <label className="block space-y-1 text-sm">
              <span className="font-medium">
                {kind === "recipe" ? "Servings to cook" : "Portions"}
              </span>
              <input
                type="number"
                min={kind === "recipe" ? "1" : "0.5"}
                step={kind === "recipe" ? "1" : "0.5"}
                max={kind === "leftover" ? Math.max(availableFor(leftoverChoice), 0.5) : 48}
                value={portions}
                onChange={(event) => setPortions(event.target.value)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
              />
              {kind === "recipe" && (
                <span className="block text-xs text-neutral-500">
                  {recipes.find((recipe) => recipe.id === recipeId)?.title ?? "This recipe"} makes{" "}
                  {servingsFor(recipeId)} per batch. You eat one that night, so{" "}
                  {Math.max(0, Number(portions || 0) - 1)} spare.
                </span>
              )}
            </label>

            {kind === "recipe" && (
              <div className="flex gap-2">
                {[1, 2, 3].map((multiplier) => (
                  <button
                    key={multiplier}
                    type="button"
                    onClick={() => setPortions(String(servingsFor(recipeId) * multiplier))}
                    className="flex-1 rounded-md border border-neutral-300 px-2 py-1.5 text-xs text-neutral-600 dark:border-neutral-700 dark:text-neutral-400"
                  >
                    ×{multiplier} ({servingsFor(recipeId) * multiplier} servings)
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={submitAdd}
              disabled={
                pending ||
                (kind === "recipe"
                  ? recipeId === ""
                  : leftoverChoice === "" || availableFor(leftoverChoice) <= 0)
              }
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
