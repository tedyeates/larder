import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for use in Client Components.
 *
 * Holds only the anon key, which is safe to ship in the browser bundle —
 * every query it makes is scoped by Row Level Security.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
