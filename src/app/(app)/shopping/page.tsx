"use client";

import { useEffect, useRef, useState, type FormEvent, type PointerEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { listIngredients } from "@/lib/ingredients/registry";
import { addPlacement, listAisles } from "@/lib/shops/shops";
import type { AisleWithPlacementCount } from "@/lib/shops/types";
import {
  addShoppingItem,
  buyShoppingItem,
  dismissShoppingItem,
  listShoppingList,
} from "@/lib/shopping/shopping";
import type { Ingredient } from "@/lib/ingredients/types";
import type { ShoppingItem, ShoppingShop } from "@/lib/shopping/types";
import {
  STORAGE_LOCATIONS,
  STORAGE_LOCATION_LABELS,
  type StorageLocation,
} from "@/lib/pantry/types";

type LoadState = "loading" | "loaded" | "error";
type PurchaseInput = { purchasedAmount: number; storageLocation: StorageLocation; ingredientId: string };

/** Pointer travel that separates a tap from a swipe, in CSS pixels. */
const SWIPE_THRESHOLD_PX = 48;

/**
 * One persistent Shopping List viewed through one Shop at a time. A tab is
 * intentionally a projection, not a separate list: buying or dismissing a
 * line refreshes every Shop view because the database transition changes the
 * one underlying Shopping Item.
 */
export default function ShoppingPage() {
  const [shops, setShops] = useState<ShoppingShop[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [selectedShopId, setSelectedShopId] = useState<string | null>(null);

  async function refresh() {
    setState("loading");
    setError(null);
    try {
      const supabase = createClient();
      const [shopRows, ingredientRows] = await Promise.all([
        listShoppingList(supabase),
        listIngredients(supabase),
      ]);
      setShops(shopRows);
      setIngredients(ingredientRows);
      setSelectedShopId((current) =>
        current && shopRows.some((shop) => shop.id === current) ? current : (shopRows[0]?.id ?? null)
      );
      setState("loaded");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load Shopping List");
      setState("error");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleAdd(ingredientId: string, requiredAmount: number) {
    await addShoppingItem(createClient(), ingredientId, requiredAmount);
    await refresh();
  }

  async function handleBuy(itemId: string, input: PurchaseInput) {
    await buyShoppingItem(createClient(), itemId, input);
    await refresh();
  }

  async function handleDismiss(itemId: string) {
    await dismissShoppingItem(createClient(), itemId);
    await refresh();
  }

  const selectedShop = shops.find((shop) => shop.id === selectedShopId) ?? null;

  return (
    <div className="space-y-6 pb-20">
      <div>
        <h1 className="text-xl font-semibold">Shopping</h1>
        <p className="mt-2 text-sm text-foreground/60">
          One list, grouped by the Aisles you walk. Lines stay until you buy or dismiss them.
        </p>
      </div>

      <AddShoppingItemForm ingredients={ingredients} onAdd={handleAdd} />

      {state === "loading" ? (
        <p className="text-sm text-foreground/60">Loading…</p>
      ) : state === "error" ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : shops.length === 0 ? (
        <p data-testid="shopping-empty" className="text-sm text-foreground/60">
          No Shops yet. Add one in Shops to view this list by Aisle.
        </p>
      ) : (
        <>
          <div role="tablist" aria-label="Shops" className="flex gap-2 overflow-x-auto pb-1">
            {shops.map((shop) => (
              <button
                key={shop.id}
                id={`shop-tab-${shop.id}`}
                type="button"
                role="tab"
                aria-selected={selectedShop?.id === shop.id}
                aria-controls={`shop-panel-${shop.id}`}
                onClick={() => setSelectedShopId(shop.id)}
                className={`shrink-0 rounded-md px-4 py-3 text-sm font-medium ${
                  selectedShop?.id === shop.id
                    ? "bg-foreground text-background"
                    : "border border-foreground/20 text-foreground/70"
                }`}
              >
                {shop.name}
              </button>
            ))}
          </div>

          {selectedShop ? (
            <ShopList
              shop={selectedShop}
              onBuy={handleBuy}
              onDismiss={handleDismiss}
              onChanged={refresh}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

function AddShoppingItemForm({
  ingredients,
  onAdd,
}: {
  ingredients: Ingredient[];
  onAdd: (ingredientId: string, requiredAmount: number) => Promise<void>;
}) {
  const [ingredientId, setIngredientId] = useState("");
  const [requiredAmount, setRequiredAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onAdd(ingredientId, Number(requiredAmount));
      setIngredientId("");
      setRequiredAmount("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to add Shopping Item");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="grid gap-2 rounded-md border border-foreground/10 p-4 sm:grid-cols-[1fr_9rem_auto] sm:items-end"
    >
      <div className="space-y-1">
        <label htmlFor="shopping-ingredient" className="text-xs font-medium text-foreground/60">
          Shopping item
        </label>
        <select
          id="shopping-ingredient"
          required
          value={ingredientId}
          onChange={(event) => setIngredientId(event.target.value)}
          className="w-full rounded-md border border-foreground/20 bg-transparent px-3 py-3 text-sm outline-none focus:border-foreground/50"
        >
          <option value="" disabled>
            Choose an Ingredient
          </option>
          {ingredients.map((ingredient) => (
            <option key={ingredient.id} value={ingredient.id}>
              {ingredient.name} ({ingredient.stockUnit})
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="shopping-required-amount" className="text-xs font-medium text-foreground/60">
          Required amount
        </label>
        <input
          id="shopping-required-amount"
          required
          type="number"
          min="0"
          step="any"
          value={requiredAmount}
          onChange={(event) => setRequiredAmount(event.target.value)}
          placeholder="1"
          className="w-full rounded-md border border-foreground/20 bg-transparent px-3 py-3 text-sm outline-none focus:border-foreground/50"
        />
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-foreground px-4 py-3 text-sm font-medium text-background disabled:opacity-50"
      >
        {submitting ? "Adding…" : "Add item"}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-red-600 sm:col-span-3">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function ShopList({
  shop,
  onBuy,
  onDismiss,
  onChanged,
}: {
  shop: ShoppingShop;
  onBuy: (itemId: string, input: PurchaseInput) => Promise<void>;
  onDismiss: (itemId: string) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const [aisles, setAisles] = useState<AisleWithPlacementCount[]>([]);
  const [aisleError, setAisleError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function loadAisles() {
      setAisleError(null);
      try {
        const rows = await listAisles(createClient(), shop.id);
        if (active) setAisles(rows);
      } catch (error) {
        if (active) {
          setAisleError(error instanceof Error ? error.message : "Failed to load Aisles");
        }
      }
    }
    loadAisles();
    return () => {
      active = false;
    };
  }, [shop.id]);

  async function handleAssign(ingredientId: string, aisleId: string) {
    await addPlacement(createClient(), { ingredientId, aisleId });
    await onChanged();
  }

  return (
    <div
      id={`shop-panel-${shop.id}`}
      role="tabpanel"
      aria-labelledby={`shop-tab-${shop.id}`}
      className="space-y-5"
    >
      {aisleError ? (
        <p role="alert" className="text-sm text-red-600">
          {aisleError}
        </p>
      ) : null}
      {shop.sections.length === 0 ? (
        <p data-testid="shop-list-empty" className="text-sm text-foreground/60">
          Nothing to buy here yet.
        </p>
      ) : (
        shop.sections.map((section) => (
          <section key={section.id} aria-label={section.name}>
            <h2 className="text-sm font-semibold text-foreground/80">
              {section.emoji ? `${section.emoji} ` : ""}
              {section.name}
            </h2>
            <ul className="mt-2 divide-y divide-foreground/10">
              {section.items.map((item) => (
                <ShoppingItemRow
                  key={item.id}
                  item={item}
                  unsorted={section.isUnsorted}
                  aisles={aisles}
                  onAssign={handleAssign}
                  onBuy={onBuy}
                  onDismiss={onDismiss}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function ShoppingItemRow({
  item,
  unsorted,
  aisles,
  onAssign,
  onBuy,
  onDismiss,
}: {
  item: ShoppingItem;
  unsorted: boolean;
  aisles: AisleWithPlacementCount[];
  onAssign: (ingredientId: string, aisleId: string) => Promise<void>;
  onBuy: (itemId: string, input: PurchaseInput) => Promise<void>;
  onDismiss: (itemId: string) => Promise<void>;
}) {
  const choices = [
    {
      ingredientId: item.ingredientId,
      ingredientName: item.ingredientName,
      stockUnit: item.stockUnit,
      lastPurchasedAmount: item.lastPurchasedAmount,
    },
    ...item.substitutes,
  ];
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selected = choices[selectedIndex] ?? choices[0];
  const suggestedAmount = selected.lastPurchasedAmount ?? item.requiredAmount;
  const [storageLocation, setStorageLocation] = useState<StorageLocation>("cupboard");
  const [customAmount, setCustomAmount] = useState(String(suggestedAmount));
  const [aisleId, setAisleId] = useState("");
  const [actionsOpen, setActionsOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A completed swipe is followed by a synthetic click on some platforms and by
  // nothing at all on others, so suppression lives in a ref cleared by the next
  // pointerdown rather than in state: a stale flag would swallow a real tap.
  const gestureHandled = useRef(false);

  useEffect(() => {
    setCustomAmount(String(suggestedAmount));
  }, [suggestedAmount]);

  async function handleBuy(amount: number) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onBuy(item.id, {
        purchasedAmount: amount,
        storageLocation,
        ingredientId: selected.ingredientId,
      });
    } catch (buyError) {
      setError(buyError instanceof Error ? buyError.message : "Failed to buy Shopping Item");
      setBusy(false);
    }
  }

  async function handleDismiss() {
    setBusy(true);
    setError(null);
    try {
      await onDismiss(item.id);
    } catch (dismissError) {
      setError(dismissError instanceof Error ? dismissError.message : "Failed to dismiss Shopping Item");
      setBusy(false);
    }
  }

  async function handleAssign() {
    if (!aisleId) return;
    setBusy(true);
    setError(null);
    try {
      await onAssign(item.ingredientId, aisleId);
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : "Failed to assign Aisle");
      setBusy(false);
    }
  }

  function cycleSubstitute(offset: number) {
    if (choices.length < 2) return;
    setSelectedIndex((current) => (current + offset + choices.length) % choices.length);
  }

  function handlePointerDown(event: PointerEvent<HTMLLIElement>) {
    gestureHandled.current = false;
    event.currentTarget.dataset.gestureStart = `${event.clientX}:${event.clientY}`;
  }

  function handlePointerUp(event: PointerEvent<HTMLLIElement>) {
    const start = event.currentTarget.dataset.gestureStart;
    delete event.currentTarget.dataset.gestureStart;
    if (!start) return;

    const [startX, startY] = start.split(":").map(Number);
    const xDistance = event.clientX - startX;
    const yDistance = event.clientY - startY;
    if (Math.max(Math.abs(xDistance), Math.abs(yDistance)) < SWIPE_THRESHOLD_PX) return;

    gestureHandled.current = true;
    if (Math.abs(xDistance) > Math.abs(yDistance)) {
      if (xDistance > 0) void handleBuy(suggestedAmount);
      else setActionsOpen(true);
    } else {
      cycleSubstitute(yDistance < 0 ? 1 : -1);
    }
  }

  function handleTap() {
    if (gestureHandled.current) return;
    void handleBuy(suggestedAmount);
  }

  return (
    <li
      data-testid={`shopping-item-${item.id}`}
      className="space-y-2 py-4 touch-none"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
    >
      <div
        onClick={handleTap}
        className="cursor-pointer rounded-md p-2 transition-transform duration-150 ease-out active:scale-[0.98]"
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-medium">{item.ingredientName}</span>
          <span className="text-xs text-foreground/50">Buying: {selected.ingredientName}</span>
        </div>
        <div className="mt-2 flex gap-2 text-sm">
          <span className="rounded bg-foreground/10 px-2 py-1">Required: {item.requiredAmount} {item.stockUnit}</span>
          <span className="rounded bg-foreground px-2 py-1 font-medium text-background">Suggested: {suggestedAmount} {selected.stockUnit}</span>
        </div>
      </div>

      {unsorted ? (
        <div className="flex gap-2">
          <label htmlFor={`assign-aisle-${item.id}`} className="sr-only">
            Aisle for {item.ingredientName}
          </label>
          <select
            id={`assign-aisle-${item.id}`}
            value={aisleId}
            onChange={(event) => setAisleId(event.target.value)}
            className="min-w-0 flex-1 rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-sm"
          >
            <option value="">Give this an Aisle…</option>
            {aisles.map((aisle) => (
              <option key={aisle.id} value={aisle.id}>
                {aisle.emoji} {aisle.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || !aisleId}
            onClick={handleAssign}
            className="rounded-md border border-foreground/20 px-3 py-2 text-sm disabled:opacity-50"
          >
            Assign aisle
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 px-2">
        <button
          type="button"
          onClick={() => void handleBuy(suggestedAmount)}
          disabled={busy}
          aria-label="Buy suggested amount"
          className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-50"
        >
          Buy
        </button>
        <button
          type="button"
          onClick={() => setActionsOpen((open) => !open)}
          disabled={busy}
          aria-label="Show shopping actions"
          aria-expanded={actionsOpen}
          className="rounded-md border border-foreground/20 px-3 py-2 text-sm disabled:opacity-50"
        >
          Actions
        </button>
        {choices.length > 1 ? (
          <>
            <button type="button" onClick={() => cycleSubstitute(-1)} aria-label="Previous substitute" className="rounded-md border border-foreground/20 px-3 py-2 text-sm">
              Previous
            </button>
            <button type="button" onClick={() => cycleSubstitute(1)} aria-label="Next substitute" className="rounded-md border border-foreground/20 px-3 py-2 text-sm">
              Next
            </button>
          </>
        ) : null}
      </div>

      <div
        aria-hidden={!actionsOpen}
        inert={!actionsOpen}
        className={`grid overflow-hidden transition-all duration-200 ease-out ${actionsOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
      >
        <div className="min-h-0">
          <div className="grid gap-2 rounded-md border border-foreground/15 p-3 sm:grid-cols-2">
            <label className="text-sm text-foreground/70" htmlFor={`buy-location-${item.id}`}>
              Store in
              <select
                id={`buy-location-${item.id}`}
                aria-label={`Storage Location for ${item.ingredientName}`}
                value={storageLocation}
                onChange={(event) => setStorageLocation(event.target.value as StorageLocation)}
                className="mt-1 w-full rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-sm"
              >
                {STORAGE_LOCATIONS.map((location) => (
                  <option key={location} value={location}>
                    {STORAGE_LOCATION_LABELS[location]}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap content-end gap-2">
              <button type="button" onClick={() => void handleBuy(item.requiredAmount)} disabled={busy} aria-label="Buy required amount" className="rounded-md border border-foreground/20 px-3 py-2 text-sm disabled:opacity-50">
                Buy required amount
              </button>
              <button type="button" onClick={() => setCustomOpen(true)} disabled={busy} aria-label="Buy custom amount" className="rounded-md border border-foreground/20 px-3 py-2 text-sm disabled:opacity-50">
                Buy custom amount
              </button>
              <button type="button" onClick={() => void handleDismiss()} disabled={busy} aria-label="Delete without stocking" className="rounded-md border border-red-600/40 px-3 py-2 text-sm text-red-600 disabled:opacity-50">
                Delete without stocking
              </button>
            </div>
            {customOpen ? (
              <div className="flex gap-2 sm:col-span-2">
                <label className="sr-only" htmlFor={`custom-amount-${item.id}`}>Custom amount for {item.ingredientName}</label>
                <input
                  id={`custom-amount-${item.id}`}
                  type="number"
                  min="0"
                  step="any"
                  value={customAmount}
                  onChange={(event) => setCustomAmount(event.target.value)}
                  className="min-w-0 flex-1 rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-sm"
                />
                <button type="button" onClick={() => void handleBuy(Number(customAmount))} disabled={busy || Number(customAmount) <= 0} aria-label="Confirm custom purchase" className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-50">
                  Buy custom
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </li>
  );
}
