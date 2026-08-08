# Security

Project-wide security decisions and constraints. Accumulates across features.

## Auth Model

Supabase Auth, single authenticated user. The browser holds the anon key and a user JWT; every
request is scoped by RLS. There is no unauthenticated surface — the app holds recipes, purchase
history and eating habits, and is deployed publicly on Vercel.

## Absolute Constraints

- **RLS on every table from the first migration.** The anon key ships inside the JavaScript bundle,
  so any table without RLS is world-readable and world-writable.
- **The service-role key is server-side only.** Never in the browser bundle, never in an Agent Runner
  container, never in client-side environment variables.
- **RPC functions validate the caller.** Transitions run as Supabase RPCs; any `SECURITY DEFINER`
  function must check `auth.uid()` explicitly rather than trusting its invoker.

## Agent Runner Boundary

The planning AI runs in a container outside the trust boundary. See
`docs/adr/0002-ai-optional-agent-runner.md`.

- Authenticated by an **Agent Token**: a random secret stored hashed, revocable, resolved server-side
  to the owning user. Never a database credential.
- The container reaches the database only through the app's API. It never holds Supabase keys.
- Model-provider credentials live in the container's own environment, not in the app.
- **Write scope is deliberately narrow.** The runner may create Draft Recipes, Draft Ingredients, Plan
  Proposals and Preference rows. It may not write Stock Lots, Portion Batches, Meal Log entries or
  Shopping Items, and it may not promote a Draft to Confirmed — only the user's confirmation does
  that.
- Structural validation (Plan Check) runs inside the database on submission, so a compromised or
  malfunctioning runner cannot insert a plan that breaks portion arithmetic or references unresolved
  ingredients.

## Sensitive Endpoints

| Endpoint | Exposure | Protection |
|----------|----------|-----------|
| MCP tool routes | Called by the Agent Runner | Agent Token bearer auth, resolved server-side; per-tool write scope |
| Chat relay | Local deployment only | Absent entirely when no runner URL is configured |
| Supabase RPCs | Reachable with the anon key | RLS plus `auth.uid()` checks inside each function |

## Known Issues Inherited

- The archived `tedyeates/Pantry` repo contains a committed `.env` in public git history. Confirmed by
  the owner to hold no live credentials. If that history is ever reused, treat the file as suspect and
  rotate anything resembling a key.

## File Index

| Path | Summary |
|------|---------|
