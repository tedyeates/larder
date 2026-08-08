# Testing

Project-wide test strategy and conventions. Accumulates across features.

## Frameworks

| Layer | Tool | Command |
|-------|------|---------|
| Postgres transitions and views | pgTAP | `npx supabase test db` (host — needs local Supabase) |
| TypeScript units | Vitest | `pnpm test` |
| React interaction | Testing Library | `pnpm test` |
| End-to-end | Playwright | separate e2e command, to be added with the first spec |

Type checking via `pnpm check` (`tsc --noEmit`). Config lives in `.kiro/steering/project-config.md`;
`host_test_command` exists because pgTAP needs a real local Supabase rather than a worktree.

## Strategy

Most behaviour lives in Postgres, so most tests are pgTAP. That is deliberate: state transitions are
`plpgsql` functions so that the UI and the MCP share one implementation, which means one seam covers
both callers.

Nothing is mocked at the Postgres seam — tests seed rows, call the RPC, and assert resulting table
state. The HTTP seam also runs against a real local database. Mocks appear in exactly one place: a
fake Agent Runner implementing the accept-message / stream-reply / submit-proposal contract, because
the real one is an AI and cannot be asserted against.

Tests assert observable state through a seam, never which internal function ran.

## Seams

| Seam | Kind | Covers |
|------|------|--------|
| Postgres RPCs and views | pgTAP | Inventory, Ingredient Registry, Recipe, Cook, Meal Plan, Shopping, Shops & Placements, Preferences |
| Recipe Parser function | Vitest | Markdown parsing and Inconsistency detection |
| App HTTP API including MCP routes | Vitest + local Supabase | Agent Gateway auth, RLS, request shapes |
| Agent Runner contract | Vitest + fake runner | Chat relay, revision loop, graceful degradation when absent |
| End-to-end happy path | Playwright | Whole cascade wired together |

The e2e seam is mandatory rather than optional here: the product is a cascade across modules, and unit
and integration seams mock precisely the boundaries where it breaks — a shopping screen that never
calls buy, or a Cook that depletes without producing Portions.

## Conventions

- pgTAP tests: `supabase/tests/{module}.test.sql`, one file per module, mirroring the RPC names.
- Vitest: colocated `*.test.ts` beside the unit under test.
- Playwright: `tests/*.spec.ts` at the repo root, following the archived `Pantry` repo's layout.
- Migrations: `supabase/migrations/`, following `transaction-ledger`.
- Prefer table-driven cases where input space is combinatorial — notably the Recipe Parser and unit
  conversion.

## Coverage Priorities

Inventory and Ingredient Registry get the densest coverage, because every other module's correctness
depends on them. Named cases: consuming across two Lots of differing age; consuming more than exists;
same-day merge versus next-day new Lot; conversion with and without a factor; Hand-Depleted
Ingredients ignored by depletion.

Cook is tested for preview/commit agreement — previewed discrepancies must equal what commit clamps.

Plan Check is tested with proposals failing each rule individually, since precise rejection messages
are its entire purpose.

Agent Gateway is tested for auth failures first: no token, revoked token, valid token attempting a
forbidden write.

UI gets Testing Library coverage only where interaction logic is real — the shopping list's tap,
swipe-left menu and swipe up/down substitute cycling.

## Prior Art

`transaction-ledger` — Vitest with `pnpm test`, pgTAP via `npx supabase test db`, migrations under
`supabase/migrations/`, tests under `supabase/tests/`, plus `fast-check` for property-based tests.
The archived `Pantry` repo used Playwright with `playwright.config.ts` and a `tests/` directory.

## File Index

| Path | Summary |
|------|---------|
