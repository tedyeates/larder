"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  createPreference,
  deletePreference,
  listPreferences,
  updatePreference,
} from "@/lib/preferences/preferences";
import type { Preference } from "@/lib/preferences/types";
import { AgentTokensPanel } from "./agent-tokens";

type LoadState = "loading" | "loaded" | "error";

/**
 * Settings screen, currently just Preferences: flat rows of stated
 * leanings the AI reads every planning session and reasons with. These
 * are deliberately not rules — nothing here or anywhere else in the app
 * enforces or validates a Preference's body. Structural checks belong to
 * Plan Check; taste, variety and diet are things you reject
 * conversationally if the AI ignores them. See
 * .kiro/specs/larder-core/design.md (Q16).
 */
export default function SettingsPage() {
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function refresh() {
    setLoadState("loading");
    setErrorMessage(null);
    try {
      const supabase = createClient();
      const rows = await listPreferences(supabase);
      setPreferences(rows);
      setLoadState("loaded");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load Preferences");
      setLoadState("error");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleCreate(input: { body: string; category: string }) {
    const supabase = createClient();
    await createPreference(supabase, {
      body: input.body,
      category: input.category.trim() === "" ? null : input.category,
    });
    await refresh();
  }

  async function handleUpdate(id: string, input: { body: string; category: string }) {
    const supabase = createClient();
    await updatePreference(supabase, id, {
      body: input.body,
      category: input.category.trim() === "" ? null : input.category,
    });
    await refresh();
  }

  async function handleDelete(id: string) {
    const supabase = createClient();
    await deletePreference(supabase, id);
    await refresh();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Preferences</h1>
        <p className="mt-2 text-sm text-foreground/60">
          Leanings the AI reads before every planning session — not rules. Nothing here is
          enforced; if the AI ignores one, say so in the conversation.
        </p>
      </div>

      <CreatePreferenceForm onCreate={handleCreate} />

      {loadState === "loading" ? (
        <p className="text-sm text-foreground/60">Loading…</p>
      ) : loadState === "error" ? (
        <p role="alert" className="text-sm text-red-600">
          {errorMessage}
        </p>
      ) : preferences.length === 0 ? (
        <p data-testid="preferences-empty" className="text-sm text-foreground/60">
          No Preferences yet. Add one above.
        </p>
      ) : (
        <ul className="divide-y divide-foreground/10">
          {preferences.map((preference) => (
            <PreferenceRow
              key={preference.id}
              preference={preference}
              onUpdate={(input) => handleUpdate(preference.id, input)}
              onDelete={() => handleDelete(preference.id)}
            />
          ))}
        </ul>
      )}

      <AgentTokensPanel />
    </div>
  );
}

function CreatePreferenceForm({
  onCreate,
}: {
  onCreate: (input: { body: string; category: string }) => Promise<void>;
}) {
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onCreate({ body, category });
      setBody("");
      setCategory("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to create Preference");
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
        <label htmlFor="preference-body" className="text-xs font-medium text-foreground/60">
          Preference
        </label>
        <input
          id="preference-body"
          required
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Don't repeat a recipe within four weeks"
          className="w-full rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/50"
        />
      </div>
      <div className="space-y-1 sm:w-40">
        <label htmlFor="preference-category" className="text-xs font-medium text-foreground/60">
          Category (optional)
        </label>
        <input
          id="preference-category"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          placeholder="variety"
          className="w-full rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/50"
        />
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-50"
      >
        {submitting ? "Adding…" : "Add Preference"}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-red-600 sm:basis-full">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function PreferenceRow({
  preference,
  onUpdate,
  onDelete,
}: {
  preference: Preference;
  onUpdate: (input: { body: string; category: string }) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [bodyDraft, setBodyDraft] = useState(preference.body);
  const [categoryDraft, setCategoryDraft] = useState(preference.category ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onUpdate({ body: bodyDraft, category: categoryDraft });
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

  const updatedAtLabel = new Date(preference.updatedAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <li className="py-3">
      {editing ? (
        <form onSubmit={handleEditSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1">
            <label htmlFor={`edit-body-${preference.id}`} className="sr-only">
              Preference text
            </label>
            <input
              id={`edit-body-${preference.id}`}
              value={bodyDraft}
              onChange={(event) => setBodyDraft(event.target.value)}
              className="w-full rounded-md border border-foreground/20 bg-transparent px-2 py-1 text-sm outline-none focus:border-foreground/50"
            />
          </div>
          <div className="space-y-1 sm:w-40">
            <label htmlFor={`edit-category-${preference.id}`} className="sr-only">
              Category
            </label>
            <input
              id={`edit-category-${preference.id}`}
              value={categoryDraft}
              onChange={(event) => setCategoryDraft(event.target.value)}
              placeholder="Category (optional)"
              className="w-full rounded-md border border-foreground/20 bg-transparent px-2 py-1 text-sm outline-none focus:border-foreground/50"
            />
          </div>
          <div className="flex items-center gap-2">
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
                setBodyDraft(preference.body);
                setCategoryDraft(preference.category ?? "");
              }}
              className="rounded-md border border-foreground/20 px-2 py-1 text-xs"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex-1">
            <p className="text-sm">{preference.body}</p>
            <p className="mt-1 text-xs text-foreground/60">
              {preference.category ? (
                <span className="mr-2 rounded-full border border-foreground/20 px-2 py-0.5">
                  {preference.category}
                </span>
              ) : null}
              Updated {updatedAtLabel}
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-md border border-foreground/20 px-2 py-1 text-xs"
            >
              Edit
            </button>
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
      )}

      {error ? (
        <p role="alert" className="mt-1 text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </li>
  );
}
