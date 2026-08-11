import type { SupabaseClient } from "@supabase/supabase-js";
import type { Preference } from "./types";

/**
 * Data access for Preferences. Thin wrappers around Supabase table
 * access — there is no RPC and no server-side logic here on purpose:
 * Preferences are flat rows the AI reads and reasons with, and the app
 * never enforces or validates against them (see
 * supabase/migrations/20260103000000_preferences.sql).
 *
 * Each function takes the Supabase client as a parameter rather than
 * constructing one, so callers can pass a browser client from a Client
 * Component or a server client from a Server Action, and so tests can
 * pass a mock without reaching into module internals.
 */

type Row = Record<string, unknown>;

function toPreference(row: Row): Preference {
  return {
    id: row.id as string,
    category: (row.category as string | null) ?? null,
    body: row.body as string,
    updatedAt: row.updated_at as string,
  };
}

function errorMessage(error: { message: string } | null, fallback: string): string {
  return error?.message ?? fallback;
}

/**
 * Lists every Preference, most recently updated first — this is a list
 * skimmed often, so ordering is stable (ties broken by id) rather than
 * shuffling on repeat loads.
 */
export async function listPreferences(client: SupabaseClient): Promise<Preference[]> {
  const { data, error } = await client
    .from("preferences")
    .select("*")
    .order("updated_at", { ascending: false })
    .order("id", { ascending: true });

  if (error) {
    throw new Error(errorMessage(error, "Failed to load Preferences"));
  }

  return (data ?? []).map(toPreference);
}

export async function createPreference(
  client: SupabaseClient,
  input: { body: string; category?: string | null }
): Promise<Preference> {
  const { data, error } = await client
    .from("preferences")
    .insert({
      body: input.body,
      category: input.category ?? null,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(errorMessage(error, "Failed to create Preference"));
  }

  return toPreference(data);
}

export async function updatePreference(
  client: SupabaseClient,
  id: string,
  input: { body?: string; category?: string | null }
): Promise<Preference> {
  const patch: Row = {};
  if (input.body !== undefined) patch.body = input.body;
  if (input.category !== undefined) patch.category = input.category;

  const { data, error } = await client
    .from("preferences")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(errorMessage(error, "Failed to update Preference"));
  }

  return toPreference(data);
}

export async function deletePreference(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from("preferences").delete().eq("id", id);

  if (error) {
    throw new Error(errorMessage(error, "Failed to delete Preference"));
  }
}
