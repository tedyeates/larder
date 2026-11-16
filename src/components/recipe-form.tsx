"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import { createRecipe } from "@/actions/recipes";
import { siblingUnits, type UnitCode } from "@/domain/units";
import type { IngredientOption } from "@/lib/catalogue";
import { IngredientPicker } from "./ingredient-picker";

interface Line {
  readonly key: number;
  readonly ingredientId: string;
  readonly quantity: string;
  readonly unit: UnitCode;
}

let nextKey = 2;

export function RecipeForm({ ingredients }: { ingredients: readonly IngredientOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [servings, setServings] = useState("2");
  const [steps, setSteps] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [catalogue, setCatalogue] = useState<IngredientOption[]>([...ingredients]);
  const [lines, setLines] = useState<Line[]>([
    { key: 1, ingredientId: "", quantity: "", unit: "g" },
  ]);

  function updateLine(key: number, patch: Partial<Line>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function addLine() {
    setLines((current) => [
      ...current,
      { key: nextKey++, ingredientId: "", quantity: "", unit: "g" },
    ]);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const payload = lines
      .filter((line) => line.ingredientId !== "" && line.quantity !== "")
      .map((line) => ({
        ingredientId: line.ingredientId,
        quantity: Number(line.quantity),
        unit: line.unit,
      }));

    if (payload.length === 0) {
      setError("Add at least one ingredient with an amount.");
      return;
    }

    const formData = new FormData();
    formData.set("title", title);
    formData.set("servings", servings);
    formData.set("steps", steps);
    formData.set("lines", JSON.stringify(payload));

    startTransition(async () => {
      const result = await createRecipe(formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.push("/recipes");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Title</span>
          <input
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Chilli"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Servings</span>
          <input
            type="number"
            min="1"
            max="24"
            required
            value={servings}
            onChange={(event) => setServings(event.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Ingredients</h2>
        {lines.map((line) => {
          const selected = catalogue.find((item) => item.id === line.ingredientId);
          const units = selected ? siblingUnits(selected.stockUnit) : ["g"];
          return (
            <div key={line.key} className="grid gap-2 sm:grid-cols-[1fr_6rem_5rem_auto]">
              <IngredientPicker
                options={catalogue}
                value={line.ingredientId}
                onSelect={(option) => {
                  setCatalogue((current) =>
                    current.some((item) => item.id === option.id) ? current : [...current, option],
                  );
                  updateLine(line.key, {
                    ingredientId: option.id,
                    unit: siblingUnits(option.stockUnit)[0] ?? "g",
                  });
                }}
              />

              <input
                type="number"
                min="0.01"
                step="any"
                value={line.quantity}
                onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                placeholder="Qty"
                aria-label="Quantity"
                className="rounded-lg border border-neutral-300 px-2 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              />

              <select
                value={line.unit}
                onChange={(event) => updateLine(line.key, { unit: event.target.value as UnitCode })}
                aria-label="Unit"
                className="rounded-lg border border-neutral-300 px-2 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              >
                {units.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => setLines((current) => current.filter((row) => row.key !== line.key))}
                disabled={lines.length === 1}
                className="rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-500 disabled:opacity-40 dark:border-neutral-700"
              >
                ×
              </button>
            </div>
          );
        })}

        <button
          type="button"
          onClick={addLine}
          className="text-sm text-neutral-600 underline underline-offset-4 dark:text-neutral-400"
        >
          + Add ingredient
        </button>
      </section>

      <label className="block space-y-1 text-sm">
        <span className="font-medium">Steps</span>
        <span className="block text-xs text-neutral-500">
          One step per line. Markdown is supported — **bold**, lists, links.
        </span>
        <textarea
          rows={6}
          value={steps}
          onChange={(event) => setSteps(event.target.value)}
          placeholder={"One step per line.\nFry the onion.\nAdd the tomatoes and simmer."}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
      </label>

      {error !== null && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50 sm:w-auto dark:bg-white dark:text-neutral-900"
      >
        {pending ? "Saving…" : "Save recipe"}
      </button>
    </form>
  );
}
