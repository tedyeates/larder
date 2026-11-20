"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import {
  addManualItem,
  removeShoppingItem,
  tickShoppingItem,
  updateShoppingItem,
} from "@/actions/shop";
import { baseUnitFor, entryUnits, isUnitCode, type UnitCode } from "@/domain/units";
import type { IngredientOption } from "@/lib/catalogue";
import type { ShoppingRow } from "@/lib/shop";
import { IngredientPicker } from "./ingredient-picker";
import { SwipeActions } from "./swipe-actions";

type OptimisticChange =
  | { kind: "tick"; id: string }
  | { kind: "remove"; id: string }
  | { kind: "edit"; id: string; quantity: number; unit: UnitCode }
  | { kind: "add"; row: ShoppingRow };

function amountDisplay(quantity: number, unit: string): string {
  return `${Math.round(quantity * 1000) / 1000} ${unit}`.trim();
}

/** Fold one change into the list so the screen responds before the database does. */
function applyChange(rows: readonly ShoppingRow[], change: OptimisticChange): ShoppingRow[] {
  switch (change.kind) {
    case "tick":
      return rows.map((row) => (row.id === change.id ? { ...row, status: "ticked" } : row));
    case "remove":
      return rows.filter((row) => row.id !== change.id);
    case "edit":
      return rows.map((row) =>
        row.id === change.id
          ? {
              ...row,
              quantity: change.quantity,
              unit: change.unit,
              quantityLocked: true,
              display: amountDisplay(change.quantity, change.unit),
            }
          : row,
      );
    case "add":
      return [change.row, ...rows];
  }
}

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
  const [visibleRows, applyOptimistic] = useOptimistic(rows, applyChange);
  const [message, setMessage] = useState<string | null>(null);
  const [ingredientId, setIngredientId] = useState("");
  const [catalogue, setCatalogue] = useState<IngredientOption[]>([...ingredients]);
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState<UnitCode>("g");
  const [editing, setEditing] = useState<{ id: string; quantity: string; unit: UnitCode } | null>(
    null,
  );
  const [editError, setEditError] = useState<string | null>(null);

  const selected = catalogue.find((item) => item.id === ingredientId);
  const units = selected ? entryUnits(selected) : ["g"];

  /** Units that make sense for an existing row: what it's in, what it's stocked in. */
  function unitsFor(row: ShoppingRow): UnitCode[] {
    const ingredient = catalogue.find((item) => item.id === row.ingredientId);
    const options: UnitCode[] = [
      ...(row.unit !== null && isUnitCode(row.unit) ? [row.unit] : []),
      ...(ingredient ? [ingredient.stockUnit, ...entryUnits(ingredient)] : []),
    ];
    return [...new Set(options.length > 0 ? options : (["each"] as UnitCode[]))];
  }

  function startEdit(row: ShoppingRow) {
    const current = row.unit !== null && isUnitCode(row.unit) ? row.unit : unitsFor(row)[0];
    setEditing({
      id: row.id,
      quantity: row.quantity === null ? "" : String(row.quantity),
      unit: current ?? "each",
    });
    setEditError(null);
  }

  function saveEdit(row: ShoppingRow) {
    if (!editing || editing.quantity === "") return;
    const quantity = Number(editing.quantity);
    const unit = editing.unit;
    startTransition(async () => {
      applyOptimistic({ kind: "edit", id: row.id, quantity, unit });
      const result = await updateShoppingItem(row.id, { quantity, unit });
      if (result.error) {
        setEditError(result.error);
        return;
      }
      setEditing(null);
      setEditError(null);
      setMessage(result.message ?? null);
      router.refresh();
    });
  }

  function tick(row: ShoppingRow) {
    startTransition(async () => {
      applyOptimistic({ kind: "tick", id: row.id });
      const result = await tickShoppingItem(row.id);
      setMessage(result.error ?? result.message ?? null);
      if (!result.error) router.refresh();
    });
  }

  function remove(row: ShoppingRow) {
    startTransition(async () => {
      applyOptimistic({ kind: "remove", id: row.id });
      const result = await removeShoppingItem(row.id);
      if (result.error) {
        setMessage(result.error);
        return;
      }
      router.refresh();
    });
  }

  function add() {
    if (!selected || quantity === "") return;
    const label = selected.name;
    const amount = Number(quantity);
    const optimisticRow: ShoppingRow = {
      id: `pending-${Date.now()}`,
      label,
      quantity: amount,
      unit,
      display: amountDisplay(amount, unit),
      status: "pending",
      origin: "manual",
      ingredientId: selected.id,
      quantityLocked: false,
    };
    startTransition(async () => {
      applyOptimistic({ kind: "add", row: optimisticRow });
      const result = await addManualItem({
        ingredientId: selected.id,
        label,
        quantity: amount,
        unit,
      });
      setMessage(result.error ?? result.message ?? null);
      if (result.error) return;
      setQuantity("");
      router.refresh();
    });
  }

  const pendingRows = visibleRows.filter((row) => row.status === "pending");
  const doneRows = visibleRows.filter((row) => row.status !== "pending");

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

      {visibleRows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-300 px-6 py-10 text-center text-sm text-neutral-500 dark:border-neutral-700">
          The list is empty. Plan some meals and hit “Generate shopping list”, or add an item below.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-200 overflow-hidden rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {[...pendingRows, ...doneRows].map((row) => {
            const body = (
              <div className="flex items-center gap-3 px-3 py-3">
                <input
                  type="checkbox"
                  aria-label={`Tick ${row.label}`}
                  checked={row.status !== "pending"}
                  disabled={row.status !== "pending"}
                  onChange={() => tick(row)}
                  className="h-6 w-6 shrink-0 accent-neutral-900 dark:accent-neutral-100"
                />

                <div className="min-w-0 flex-1">
                  <p
                    className={`truncate text-sm ${row.status === "pending" ? "font-medium" : "text-neutral-500 line-through"}`}
                  >
                    {row.label}
                  </p>

                  {editing?.id === row.id ? (
                    <div className="mt-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min="0.01"
                          step="any"
                          value={editing.quantity}
                          onChange={(event) =>
                            setEditing((current) =>
                              current ? { ...current, quantity: event.target.value } : current,
                            )
                          }
                          aria-label={`Amount of ${row.label}`}
                          className="h-9 w-20 rounded-lg border border-neutral-300 px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                        />
                        <select
                          value={editing.unit}
                          onChange={(event) =>
                            setEditing((current) =>
                              current
                                ? { ...current, unit: event.target.value as UnitCode }
                                : current,
                            )
                          }
                          aria-label={`Unit for ${row.label}`}
                          className="h-9 rounded-lg border border-neutral-300 px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                        >
                          {unitsFor(row).map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => saveEdit(row)}
                          disabled={pending || editing.quantity === ""}
                          className="text-xs font-medium underline-offset-4 hover:underline disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(null);
                            setEditError(null);
                          }}
                          disabled={pending}
                          className="text-xs text-neutral-500 underline-offset-4 hover:underline"
                        >
                          Cancel
                        </button>
                      </div>
                      {editError !== null && (
                        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                          {editError}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-neutral-500">
                      {row.display || "no amount"}
                      {row.origin === "generated" ? " · from plan" : ""}
                      {row.quantityLocked ? " · edited" : ""}
                    </p>
                  )}
                </div>
              </div>
            );

            return (
              <li key={row.id}>
                {row.status === "pending" ? (
                  <SwipeActions
                    actions={[
                      {
                        key: "edit",
                        label: "Edit",
                        icon: <Pencil size={15} />,
                        onClick: () => startEdit(row),
                        tone: "primary",
                      },
                      {
                        key: "remove",
                        label: "Remove",
                        icon: <Trash2 size={15} />,
                        onClick: () => remove(row),
                      },
                    ]}
                  >
                    {body}
                  </SwipeActions>
                ) : (
                  body
                )}
              </li>
            );
          })}
        </ul>
      )}

      <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
        <h2 className="mb-3 text-sm font-medium">Add an item</h2>
        <div className="grid gap-2 sm:grid-cols-[1fr_6rem_5rem_auto]">
          <IngredientPicker
            options={catalogue}
            value={ingredientId}
            onSelect={(option) => {
              setCatalogue((current) =>
                current.some((item) => item.id === option.id) ? current : [...current, option],
              );
              setIngredientId(option.id);
              setUnit(baseUnitFor(option.stockUnit));
            }}
          />

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
