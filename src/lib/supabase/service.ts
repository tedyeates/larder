import "server-only";
import { buildServiceRoleClient } from "./service-role-client";

/**
 * Service-role Supabase client. Bypasses RLS entirely.
 *
 * SERVER-SIDE ONLY. The `server-only` import above makes any accidental
 * import from a Client Component a build-time error rather than a runtime
 * leak — it uses package export conditions, so it only fires when resolved
 * through Next.js's bundler, not under Vitest (see service.test.ts).
 * `SUPABASE_SERVICE_ROLE_KEY` must never be prefixed `NEXT_PUBLIC_` and must
 * never be read outside a server context.
 *
 * There is no legitimate use for this in ticket #2 — it exists so later
 * tickets have one, audited place to reach for it instead of each inventing
 * their own service-role client.
 */
export function createServiceRoleClient() {
  return buildServiceRoleClient({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
}
