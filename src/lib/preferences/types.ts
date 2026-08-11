/**
 * Domain types for Preferences (#4). Mirrors the shape of
 * `public.preferences` — see
 * supabase/migrations/20260103000000_preferences.sql.
 *
 * Preferences are deliberately not rules: they are flat rows the AI reads
 * every planning session and reasons with, but nothing in the app
 * enforces or validates against them.
 */
export type Preference = {
  id: string;
  category: string | null;
  body: string;
  updatedAt: string;
};
