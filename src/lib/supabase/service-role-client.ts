import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Pure construction logic for the service-role client, kept in its own
 * module (no `server-only` marker) so it is unit-testable. Not exported
 * from the package's public surface directly — always go through
 * `service.ts`, which adds the `server-only` import guard.
 */
export function buildServiceRoleClient(env: {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}) {
  const { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey } = env;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "createServiceRoleClient: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    );
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
