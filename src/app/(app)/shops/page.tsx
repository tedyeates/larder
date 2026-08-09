"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  addPlacement,
  createAisle,
  createShop,
  deleteAisle,
  deleteShop,
  listAisles,
  listPlacementsForAisle,
  listShops,
  removePlacement,
  renameShop,
  reorderAisles,
  reorderShops,
  updateAisle,
} from "@/lib/shops/shops";
import type { AisleWithPlacementCount, Placement, Shop } from "@/lib/shops/types";
import { listIngredients } from "@/lib/ingredients/registry";
import type { Ingredient } from "@/lib/ingredients/types";

type LoadState = "loading" | "loaded" | "error";

/**
 * Shops screen: manage Shops and their Aisles, and attach Ingredients to
 * an Aisle to build up Placements. Drill-down (Shops -> one Shop's Aisles
 * -> one Aisle's Ingredients) rather than one dense table, since this
 * screen is meant to be usable one-handed while standing in a shop.
 *
 * A Shop is a filter over the Shopping List, not a destination: nothing
 * here ever decides which Shop an Ingredient "belongs" to, and the same
 * Ingredient can be attached to Aisles in any number of Shops.
 */
export default function ShopsPage() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedShopId, setSelectedShopId] = useState<string | null>(null);

  async function refresh() {
    setLoadState("loading");
    setErrorMessage(null);
    try {
      const supabase = createClient();
      const rows = await listShops(supabase);
      setShops(rows);
      setLoadState("loaded");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load Shops");
      setLoadState("error");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleCreate(name: string) {
    const supabase = createClient();
    await createShop(supabase, name);
    await refresh();
  }

  async function handleRename(id: string, name: string) {
    const supabase = createClient();
    await renameShop(supabase, id, name);
    await refresh();
  }

  async function handleDelete(id: string) {
    const supabase = createClient();
    await deleteShop(supabase, id);
    if (selectedShopId === id) setSelectedShopId(null);
    await refresh();
  }

  async function handleMove(id: string, direction: "up" | "down") {
    const index = shops.findIndex((shop) => shop.id === id);
    const target = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= shops.length) return;

    const reordered = [...shops];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];

    const supabase = createClient();
    await reorderShops(supabase, reordered.map((shop) => shop.id));
    await refresh();
  }

  const selectedShop = shops.find((shop) => shop.id === selectedShopId) ?? null;

  if (selectedShop) {
    return <ShopDetail shop={selectedShop} onBack={() => setSelectedShopId(null)} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Shops</h1>
        <p className="mt-2 text-sm text-foreground/60">
          Views over the Shopping List, not destinations — define each Shop&apos;s Aisles in
          walking order and attach Ingredients as you spot them.
        </p>
      </div>

      <CreateShopForm onCreate={handleCreate} />

      {loadState === "loading" ? (
        <p className="text-sm text-foreground/60">Loading…</p>
      ) : loadState === "error" ? (
        <p role="alert" className="text-sm text-red-600">
          {errorMessage}
        </p>
      ) : shops.length === 0 ? (
        <p data-testid="shops-empty" className="text-sm text-foreground/60">
          No Shops yet. Add one above.
        </p>
      ) : (
        <ul className="divide-y divide-foreground/10">
          {shops.map((shop, index) => (
            <ShopRow
              key={shop.id}
              shop={shop}
              canMoveUp={index > 0}
              canMoveDown={index < shops.length - 1}
              onOpen={() => setSelectedShopId(shop.id)}
              onRename={(name) => handleRename(shop.id, name)}
              onDelete={() => handleDelete(shop.id)}
              onMoveUp={() => handleMove(shop.id, "up")}
              onMoveDown={() => handleMove(shop.id, "down")}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function CreateShopForm({ onCreate }: { onCreate: (name: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onCreate(name);
      setName("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to create Shop");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-2 rounded-md border border-foreground/10 p-4 sm:flex-row sm:items-end"
    >
      <div className="flex-1 space-y-1">
        <label htmlFor="shop-name" className="text-xs font-medium text-foreground/60">
          Name
        </label>
        <input
          id="shop-name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Lidl"
          className="w-full rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/50"
        />
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-50"
      >
        {submitting ? "Adding…" : "Add Shop"}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-red-600 sm:basis-full">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function ShopRow({
  shop,
  canMoveUp,
  canMoveDown,
  onOpen,
  onRename,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  shop: Shop;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onOpen: () => void;
  onRename: (name: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onMoveUp: () => Promise<void>;
  onMoveDown: () => Promise<void>;
}) {
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(shop.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRenameSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onRename(nameDraft);
      setEditingName(false);
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "Failed to rename");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteClick() {
    setBusy(true);
    setError(null);
    try {
      await onDelete();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete");
      setBusy(false);
    }
  }

  async function handleMove(direction: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await direction();
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : "Failed to reorder");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex-1">
          {editingName ? (
            <form onSubmit={handleRenameSubmit} className="flex items-center gap-2">
              <label htmlFor={`rename-shop-${shop.id}`} className="sr-only">
                Name for {shop.name}
              </label>
              <input
                id={`rename-shop-${shop.id}`}
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                className="w-full rounded-md border border-foreground/20 bg-transparent px-2 py-1 text-sm outline-none focus:border-foreground/50"
              />
              <button
                type="submit"
                disabled={busy}
                className="rounded-md border border-foreground/20 px-2 py-1 text-xs"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingName(false);
                  setNameDraft(shop.name);
                }}
                className="rounded-md border border-foreground/20 px-2 py-1 text-xs"
              >
                Cancel
              </button>
            </form>
          ) : (
            <button type="button" onClick={onOpen} className="text-left font-medium">
              {shop.name}
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 text-sm">
          <button
            type="button"
            onClick={() => handleMove(onMoveUp)}
            disabled={busy || !canMoveUp}
            aria-label={`Move ${shop.name} up`}
            className="rounded-md border border-foreground/20 px-2 py-1 text-xs disabled:opacity-30"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => handleMove(onMoveDown)}
            disabled={busy || !canMoveDown}
            aria-label={`Move ${shop.name} down`}
            className="rounded-md border border-foreground/20 px-2 py-1 text-xs disabled:opacity-30"
          >
            ↓
          </button>
          {!editingName ? (
            <button
              type="button"
              onClick={() => setEditingName(true)}
              className="rounded-md border border-foreground/20 px-2 py-1 text-xs"
            >
              Rename
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleDeleteClick}
            disabled={busy}
            className="rounded-md border border-foreground/20 px-2 py-1 text-xs text-red-600 disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-1 text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </li>
  );
}

function ShopDetail({ shop, onBack }: { shop: Shop; onBack: () => void }) {
  const [aisles, setAisles] = useState<AisleWithPlacementCount[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedAisleId, setSelectedAisleId] = useState<string | null>(null);

  async function refresh() {
    setLoadState("loading");
    setErrorMessage(null);
    try {
      const supabase = createClient();
      const rows = await listAisles(supabase, shop.id);
      setAisles(rows);
      setLoadState("loaded");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load Aisles");
      setLoadState("error");
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shop.id]);

  async function handleCreate(input: { name: string; emoji: string }) {
    const supabase = createClient();
    await createAisle(supabase, { shopId: shop.id, name: input.name, emoji: input.emoji });
    await refresh();
  }

  async function handleUpdate(id: string, input: { name?: string; emoji?: string }) {
    const supabase = createClient();
    await updateAisle(supabase, id, input);
    await refresh();
  }

  async function handleDelete(id: string) {
    const supabase = createClient();
    await deleteAisle(supabase, id);
    if (selectedAisleId === id) setSelectedAisleId(null);
    await refresh();
  }

  async function handleMove(id: string, direction: "up" | "down") {
    const index = aisles.findIndex((aisle) => aisle.id === id);
    const target = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= aisles.length) return;

    const reordered = [...aisles];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];

    const supabase = createClient();
    await reorderAisles(supabase, shop.id, reordered.map((aisle) => aisle.id));
    await refresh();
  }

  const selectedAisle = aisles.find((aisle) => aisle.id === selectedAisleId) ?? null;

  return (
    <div className="space-y-6">
      <div>
        <button type="button" onClick={onBack} className="text-sm text-foreground/60">
          ← All Shops
        </button>
        <h1 className="mt-2 text-xl font-semibold">{shop.name}</h1>
        <p className="mt-1 text-sm text-foreground/60">
          Aisles in the order you walk them. Tap one to attach Ingredients.
        </p>
      </div>

      <CreateAisleForm onCreate={handleCreate} />

      {loadState === "loading" ? (
        <p className="text-sm text-foreground/60">Loading…</p>
      ) : loadState === "error" ? (
        <p role="alert" className="text-sm text-red-600">
          {errorMessage}
        </p>
      ) : aisles.length === 0 ? (
        <p data-testid="aisles-empty" className="text-sm text-foreground/60">
          No Aisles yet. Add one above.
        </p>
      ) : (
        <ul className="divide-y divide-foreground/10">
          {aisles.map((aisle, index) => (
            <AisleRow
              key={aisle.id}
              aisle={aisle}
              canMoveUp={index > 0}
              canMoveDown={index < aisles.length - 1}
              onOpen={() => setSelectedAisleId(aisle.id)}
              onUpdate={(input) => handleUpdate(aisle.id, input)}
              onDelete={() => handleDelete(aisle.id)}
              onMoveUp={() => handleMove(aisle.id, "up")}
              onMoveDown={() => handleMove(aisle.id, "down")}
            />
          ))}
        </ul>
      )}

      {selectedAisle ? (
        <AislePlacements aisle={selectedAisle} onClose={() => setSelectedAisleId(null)} />
      ) : null}
    </div>
  );
}

function CreateAisleForm({
  onCreate,
}: {
  onCreate: (input: { name: string; emoji: string }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onCreate({ name, emoji });
      setName("");
      setEmoji("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to create Aisle");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-2 rounded-md border border-foreground/10 p-4 sm:flex-row sm:items-end"
    >
      <div className="w-20 space-y-1">
        <label htmlFor="aisle-emoji" className="text-xs font-medium text-foreground/60">
          Emoji
        </label>
        <input
          id="aisle-emoji"
          required
          value={emoji}
          onChange={(event) => setEmoji(event.target.value)}
          placeholder="🥬"
          className="w-full rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/50"
        />
      </div>
      <div className="flex-1 space-y-1">
        <label htmlFor="aisle-name" className="text-xs font-medium text-foreground/60">
          Name
        </label>
        <input
          id="aisle-name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Fruit & Veg"
          className="w-full rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/50"
        />
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-50"
      >
        {submitting ? "Adding…" : "Add Aisle"}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-red-600 sm:basis-full">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function AisleRow({
  aisle,
  canMoveUp,
  canMoveDown,
  onOpen,
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  aisle: AisleWithPlacementCount;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onOpen: () => void;
  onUpdate: (input: { name?: string; emoji?: string }) => Promise<void>;
  onDelete: () => Promise<void>;
  onMoveUp: () => Promise<void>;
  onMoveDown: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(aisle.name);
  const [emojiDraft, setEmojiDraft] = useState(aisle.emoji);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onUpdate({ name: nameDraft, emoji: emojiDraft });
      setEditing(false);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Failed to update");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteClick() {
    setBusy(true);
    setError(null);
    try {
      await onDelete();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete");
      setBusy(false);
    }
  }

  async function handleMove(direction: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await direction();
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : "Failed to reorder");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex-1">
          {editing ? (
            <form onSubmit={handleEditSubmit} className="flex items-center gap-2">
              <label htmlFor={`aisle-emoji-${aisle.id}`} className="sr-only">
                Emoji for {aisle.name}
              </label>
              <input
                id={`aisle-emoji-${aisle.id}`}
                value={emojiDraft}
                onChange={(event) => setEmojiDraft(event.target.value)}
                className="w-12 rounded-md border border-foreground/20 bg-transparent px-2 py-1 text-sm outline-none focus:border-foreground/50"
              />
              <label htmlFor={`aisle-name-${aisle.id}`} className="sr-only">
                Name for {aisle.name}
              </label>
              <input
                id={`aisle-name-${aisle.id}`}
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                className="w-full rounded-md border border-foreground/20 bg-transparent px-2 py-1 text-sm outline-none focus:border-foreground/50"
              />
              <button
                type="submit"
                disabled={busy}
                className="rounded-md border border-foreground/20 px-2 py-1 text-xs"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setNameDraft(aisle.name);
                  setEmojiDraft(aisle.emoji);
                }}
                className="rounded-md border border-foreground/20 px-2 py-1 text-xs"
              >
                Cancel
              </button>
            </form>
          ) : (
            <button type="button" onClick={onOpen} className="text-left">
              <span className="mr-2">{aisle.emoji}</span>
              <span className="font-medium">{aisle.name}</span>
              <span className="ml-2 text-sm text-foreground/60">
                {aisle.placementCount} item{aisle.placementCount === 1 ? "" : "s"}
              </span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 text-sm">
          <button
            type="button"
            onClick={() => handleMove(onMoveUp)}
            disabled={busy || !canMoveUp}
            aria-label={`Move ${aisle.name} up`}
            className="rounded-md border border-foreground/20 px-2 py-1 text-xs disabled:opacity-30"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => handleMove(onMoveDown)}
            disabled={busy || !canMoveDown}
            aria-label={`Move ${aisle.name} down`}
            className="rounded-md border border-foreground/20 px-2 py-1 text-xs disabled:opacity-30"
          >
            ↓
          </button>
          {!editing ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-md border border-foreground/20 px-2 py-1 text-xs"
            >
              Edit
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleDeleteClick}
            disabled={busy}
            className="rounded-md border border-foreground/20 px-2 py-1 text-xs text-red-600 disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-1 text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </li>
  );
}

function AislePlacements({
  aisle,
  onClose,
}: {
  aisle: AisleWithPlacementCount;
  onClose: () => void;
}) {
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [selectedIngredientId, setSelectedIngredientId] = useState("");
  const [adding, setAdding] = useState(false);

  async function refresh() {
    setState("loading");
    setError(null);
    try {
      const supabase = createClient();
      const [ingredientRows, placementRows] = await Promise.all([
        listIngredients(supabase),
        listPlacementsForAisle(supabase, aisle.id),
      ]);
      setIngredients(ingredientRows);
      setPlacements(placementRows);
      setState("loaded");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load Placements");
      setState("error");
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aisle.id]);

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedIngredientId) return;
    setAdding(true);
    setError(null);
    try {
      const supabase = createClient();
      await addPlacement(supabase, { ingredientId: selectedIngredientId, aisleId: aisle.id });
      setSelectedIngredientId("");
      await refresh();
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "Failed to add Placement");
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(ingredientId: string) {
    setError(null);
    try {
      const supabase = createClient();
      await removePlacement(supabase, { ingredientId, aisleId: aisle.id });
      await refresh();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Failed to remove Placement");
    }
  }

  const placedIds = new Set(placements.map((placement) => placement.ingredientId));
  const availableIngredients = ingredients.filter((ingredient) => !placedIds.has(ingredient.id));
  const placedIngredients = placements
    .map((placement) => ({
      placement,
      ingredient: ingredients.find((ingredient) => ingredient.id === placement.ingredientId),
    }))
    .filter((entry) => entry.ingredient !== undefined);

  return (
    <div className="rounded-md border border-foreground/10 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">
          {aisle.emoji} {aisle.name}
        </h2>
        <button type="button" onClick={onClose} className="text-xs text-foreground/60">
          Close
        </button>
      </div>

      {state === "loading" ? (
        <p className="mt-3 text-sm text-foreground/60">Loading…</p>
      ) : state === "error" ? (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      ) : (
        <>
          <form onSubmit={handleAdd} className="mt-3 flex items-center gap-2">
            <label htmlFor="placement-ingredient" className="sr-only">
              Ingredient to attach
            </label>
            <select
              id="placement-ingredient"
              value={selectedIngredientId}
              onChange={(event) => setSelectedIngredientId(event.target.value)}
              className="w-full rounded-md border border-foreground/20 bg-transparent px-2 py-2 text-sm outline-none focus:border-foreground/50"
            >
              <option value="">Select an Ingredient…</option>
              {availableIngredients.map((ingredient) => (
                <option key={ingredient.id} value={ingredient.id}>
                  {ingredient.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={adding || !selectedIngredientId}
              className="rounded-md border border-foreground/20 px-3 py-2 text-xs disabled:opacity-50"
            >
              Attach
            </button>
          </form>

          {error ? (
            <p role="alert" className="mt-2 text-sm text-red-600">
              {error}
            </p>
          ) : null}

          <ul className="mt-3 space-y-1">
            {placedIngredients.length === 0 ? (
              <li data-testid="placements-empty" className="text-sm text-foreground/60">
                No Ingredients attached yet.
              </li>
            ) : (
              placedIngredients.map(({ placement, ingredient }) => (
                <li key={placement.id} className="flex items-center justify-between text-sm">
                  <span>{ingredient!.name}</span>
                  <button
                    type="button"
                    onClick={() => handleRemove(placement.ingredientId)}
                    className="text-xs text-red-600"
                  >
                    Remove
                  </button>
                </li>
              ))
            )}
          </ul>
        </>
      )}
    </div>
  );
}
