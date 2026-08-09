"use client";

import { useEffect, useState, type FormEvent } from "react";
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

  async function handleBuy(itemId: string, input: { purchasedAmount: number; storageLocation: StorageLocation }) {
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
  onBuy: (itemId: string, input: { purchasedAmount: number; storageLocation: StorageLocation }) => Promise<void>;
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
  onBuy: (itemId: string, input: { purchasedAmount: number; storageLocation: StorageLocation }) => Promise<void>;
  onDismiss: (itemId: string) => Promise<void>;
}) {
  const [purchasedAmount, setPurchasedAmount] = useState(String(item.lastPurchasedAmount ?? item.requiredAmount));
  const [storageLocation, setStorageLocation] = useState<StorageLocation>("cupboard");
  const [aisleId, setAisleId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleBuy() {
    setBusy(true);
    setError(null);
    try {
      await onBuy(item.id, { purchasedAmount: Number(purchasedAmount), storageLocation });
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

  return (
    <li data-testid={`shopping-item-${item.id}`} className="space-y-2 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">{item.ingredientName}</span>
        <span className="shrink-0 text-sm text-foreground/60">
          {item.requiredAmount} {item.stockUnit}
        </span>
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

      <div className="grid grid-cols-[1fr_1fr] gap-2 sm:flex sm:items-end">
        <div>
          <label htmlFor={`buy-amount-${item.id}`} className="sr-only">
            Purchased amount for {item.ingredientName}
          </label>
          <input
            id={`buy-amount-${item.id}`}
            type="number"
            min="0"
            step="any"
            value={purchasedAmount}
            onChange={(event) => setPurchasedAmount(event.target.value)}
            className="w-full rounded-md border border-foreground/20 bg-transparent px-3 py-3 text-sm"
          />
        </div>
        <div>
          <label htmlFor={`buy-location-${item.id}`} className="sr-only">
            Storage Location for {item.ingredientName}
          </label>
          <select
            id={`buy-location-${item.id}`}
            value={storageLocation}
            onChange={(event) => setStorageLocation(event.target.value as StorageLocation)}
            className="w-full rounded-md border border-foreground/20 bg-transparent px-3 py-3 text-sm"
          >
            {STORAGE_LOCATIONS.map((location) => (
              <option key={location} value={location}>
                {STORAGE_LOCATION_LABELS[location]}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={handleBuy}
          disabled={busy || Number(purchasedAmount) <= 0}
          className="rounded-md bg-foreground px-4 py-3 text-sm font-medium text-background disabled:opacity-50"
          aria-label={`Buy ${item.ingredientName}`}
        >
          Buy
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          disabled={busy}
          className="rounded-md border border-foreground/20 px-4 py-3 text-sm text-red-600 disabled:opacity-50"
          aria-label={`Dismiss ${item.ingredientName}`}
        >
          Dismiss
        </button>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </li>
  );
}
