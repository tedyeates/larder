"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addManualItem, removeShoppingItem, tickShoppingItem } from "@/actions/shop";
import { siblingUnits, type UnitCode } from "@/domain/units";
import type { IngredientOption } from "@/lib/catalogue";
import type { ShoppingRow } from "@/lib/shop";

export function ShoppingList({
  rows,
  ingredients,
  week,
}: {
  rows: readonly ShoppingRow[];
  ingredients: readonly IngredientOption[];
  week: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [ingredientId, setIngredientId] = useState(ingredients[0]?.id ?? "");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState<UnitCode>(
    ingredients[0] ? (siblingUnits(ingredients[0].stockUnit)[0] ?? "g") : "g",
  );

  const selected = ingredients.find((item) => item.id === ingredientId);
  const units = selected ? siblingUnits(selected.stockUnit) : ["g"];

  function tick(row: ShoppingRow) {
    startTransition(async () => {
      const result = await tickShoppingItem(row.id);
      setMessage(result.error ?? result.message ?? null);
      router.refresh();
    });
  }

  function remove(row: ShoppingRow) {
    startTransition(async () => {
      await removeShoppingItem(row.id);
      router.refresh();
    });
  }

  function add() {
    if (!selected || quantity === "") return;
    startTransition(async () => {
      const result = await addManualItem({
        ingredientId: selected.id,
        label: selected.name,
        quantity: Number(quantity),
        unit,
      });
      setMessage(result.error ?? result.message ?? null);
      setQuantity("");
      router.refresh();
    });
  }

  const pendingRows = rows.filter((row) => row.status === "pending");
  const doneRows = rows.filter((row) => row.status !== "pending");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-neutral-500">
          {pendingRows.length} to buy · {doneRows.length} bought
        </p>
        <span className="text-xs text-neutral-400">Week of {week}</span>
      </div>

      {message !== null && (
        <p className="rounded-lg bg-neutral-100 px-3 py-2 text-sm dark:bg-neutral-900">{message}</p>
      )}

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-300 px-6 py-10 text-center text-sm text-neutral-500 dark:border-neutral-700">
          The list is empty. Plan some meals and hit “Generate shopping list”, or add an item below.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-200 overflow-hidden rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {[...pendingRows, ...doneRows].map((row) => (
            <li key={row.id} className="flex items-center gap-3 px-3 py-3">
              <input
                type="checkbox"
                aria-label={`Tick ${row.label}`}
                checked={row.status !== "pending"}
                disabled={pending || row.status !== "pending"}
                onChange={() => tick(row)}
                className="h-6 w-6 shrink-0 accent-neutral-900 dark:accent-neutral-100"
              />

              <div className="min-w-0 flex-1">
                <p
                  className={`truncate text-sm ${row.status === "pending" ? "font-medium" : "text-neutral-500 line-through"}`}
                >
                  {row.label}
                </p>
                <p className="text-xs text-neutral-500">
                  {row.display || "no amount"}
                  {row.origin === "generated" ? " · from plan" : ""}
                </p>
              </div>

              {row.status === "pending" && (
                <button
                  type="button"
                  onClick={() => remove(row)}
                  disabled={pending}
                  className="text-xs text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
        <h2 className="mb-3 text-sm font-medium">Add an item</h2>
        <div className="grid gap-2 sm:grid-cols-[1fr_6rem_5rem_auto]">
          <select
            value={ingredientId}
            onChange={(event) => {
              setIngredientId(event.target.value);
              const next = ingredients.find((item) => item.id === event.target.value);
              if (next) setUnit(siblingUnits(next.stockUnit)[0] ?? "g");
            }}
            aria-label="Ingredient"
            className="rounded-lg border border-neutral-300 px-2 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          >
            {ingredients.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>

          <input
            type="number"
            min="0.01"
            step="any"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            placeholder="Qty"
            aria-label="Quantity"
            className="rounded-lg border border-neutral-300 px-2 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />

          <select
            value={unit}
            onChange={(event) => setUnit(event.target.value as UnitCode)}
            aria-label="Unit"
            className="rounded-lg border border-neutral-300 px-2 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          >
            {units.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={add}
            disabled={pending || quantity === "" || !selected}
            className="rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
          >
            Add
          </button>
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          Ticking an item adds it to the pantry and gives it a best-before date.
        </p>
      </section>
    </div>
  );
}
