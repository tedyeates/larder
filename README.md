# Larder

A pantry, shopping list and weekly meal planner that never guesses arithmetic.

The app is a deterministic inventory ledger. AI is optional, external, and connects over MCP.

Read [`DESIGN.md`](./DESIGN.md) for the whole design. This file is just the map.

## Layout

```
src/domain/     pure rules — units, ledger, plan, leftovers, status. No I/O, no database.
src/db/         Drizzle schema, migrations, seed catalogue.
drizzle/        generated SQL migrations.
```

The domain layer is the product. `src/domain/` is tested without a database; `src/db/schema.test.ts`
uses PGlite (real Postgres in WASM) to prove the migration and the balance view.

## Commands

```bash
corepack pnpm install
corepack pnpm test        # 81 tests, no database required
corepack pnpm check       # tsc --noEmit
corepack pnpm lint        # biome

corepack pnpm db:generate # drizzle-kit, after schema changes
corepack pnpm db:seed     # needs DATABASE_URL (Neon)
```

Copy `.env.example` to `.env.local` for database and auth settings.

## Rules the code enforces

- Quantities live in an append-only ledger; balances are always a `SUM`.
- Conversions inside a unit family are exact. Crossing families needs an ingredient hint, or the
  line is refused — never guessed.
- Consumption is oldest-first (FEFO), and a cook never plans a deduction larger than the balance.
- A "low" ingredient is one this week's remaining meals can't cover, or one at your minimum.
- Cooking produces portions; uneaten portions become leftovers that deduct nothing later.
