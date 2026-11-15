# Larder

A pantry, shopping list and weekly meal planner that never guesses arithmetic.

The app is a deterministic inventory ledger. AI is optional, external, and connects over MCP.

Read [`DESIGN.md`](./DESIGN.md) for the whole design. This file is just the map.

## Layout

```
src/domain/     pure rules — units, ledger, plan, leftovers, status. No I/O, no database.
src/db/         Drizzle schema, migrations, seed catalogue.
src/app/        Next.js routes: /auth/sign-in, /pantry, /api/auth proxy.
src/proxy.ts    Neon Auth guard (Next 16 proxy convention — must sit beside app).
src/lib/auth/   Server proxy + browser client for Managed Better Auth.
drizzle/        generated SQL migrations.
```

The domain layer is the product. `src/domain/` is tested without a database; `src/db/schema.test.ts`
uses PGlite (real Postgres in WASM) to prove the migration and the balance view.

## Neon

The project is linked in `.neon` and configured in `neon.ts`. `.env.local` is written by
`neon deploy` and is not committed.

```bash
neon deploy            # apply neon.ts and pull branch env into .env.local
corepack pnpm db:migrate
corepack pnpm db:seed
```

`DATABASE_URL` is the pooled endpoint (app traffic). `DATABASE_URL_UNPOOLED` is the direct endpoint
(migrations only — PgBouncer transaction mode can't carry DDL).

## Commands

```bash
corepack pnpm install
corepack pnpm dev         # http://localhost:3000
corepack pnpm test        # 81 tests, no database required
corepack pnpm check       # tsc --noEmit
corepack pnpm lint        # biome
corepack pnpm build

corepack pnpm db:generate # drizzle-kit, after schema changes
corepack pnpm db:migrate  # needs DATABASE_URL_UNPOOLED
corepack pnpm db:seed     # needs DATABASE_URL
```

## Agents

Larder exposes a **read-only** MCP server at `/api/mcp`, authenticated with a single bearer token
(`LARDER_MCP_TOKEN`). It is stateless and returns JSON, so it survives serverless hosting.

- Setup page (signed in): `/agent-setup` — a copyable prompt that installs the skill, wires the MCP
  server and verifies the connection
- Planner skill: `/skills/larder-planner/SKILL.md`
- Machine-readable setup notes: `/prompts/agent-setup.md`

Tools: `list_pantry`, `expiring_soon`, `list_leftovers`, `get_week_plan`, `search_recipes`,
`get_recipe`, `propose_shopping_list`. Cooking, ticking shopping items and stock adjustments are
human actions only.

## Rules the code enforces

- Quantities live in an append-only ledger; balances are always a `SUM`.
- Conversions inside a unit family are exact. Crossing families needs an ingredient hint, or the
  line is refused — never guessed.
- Consumption is oldest-first (FEFO), and a cook never plans a deduction larger than the balance.
- A "low" ingredient is one this week's remaining meals can't cover, or one at your minimum.
- Cooking produces portions; uneaten portions become leftovers that deduct nothing later.
- Sign-in is Neon Auth; every route except the auth views requires a session.
