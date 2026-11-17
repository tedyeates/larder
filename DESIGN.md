# Larder — Design

A personal pantry, shopping list and weekly meal planner. One user today, household-ready later.
The app is a deterministic inventory ledger. AI is optional, external, and plugged in over MCP.

## 1. Principles

1. **The ledger is the product.** Every quantity change is an explicit, auditable event. No silent
   corrections, no negative stock, no arithmetic guessed by a model.
2. **AI is a client, not a component.** The web app never calls a model. Any MCP-capable agent
   (OpenCode, Claude, something local) can be the planner.
3. **Mobile is for execution, desktop is for planning.** The phone shows the list, ticks items, reads
   the pantry, and cooks dinner from a recipe. Deciding and inventing happens elsewhere.
4. **One visible total, honest dates underneath.** Quantities sum to a single number; acquisition
   dates and best-before dates live on the entries that produced that number.
5. **Fail loudly on ambiguity.** If a unit can't be converted, the app refuses and asks.
6. **Every screen can be used without an agent.** Manual entry is always a first-class path, never a
   fallback for a feature that "the AI normally does".

## 2. Architecture

```
Phone (Next.js PWA-lite)  ──┐
Desktop browser          ──┼──> Next.js on Vercel ──> Neon Postgres (Drizzle)
                            │           │
OpenCode (desktop) ── MCP ──┘           └──> TickTick API (push tasks, poll completions)
        │
        └── pulls /skills/larder-planner/SKILL.md
```

- **Next.js 16 (App Router) + React 19 + TypeScript 7** on Vercel; pnpm as the package manager.
- **Neon Postgres + Drizzle ORM**, using `@neondatabase/serverless`'s **Pool** driver (WebSocket) on the
  Node runtime, not the HTTP driver — multi-row writes need real interactive transactions, and
  `neon-http` doesn't do them. Raw SQL where the ledger maths belongs.
- **Tailwind 4 + shadcn/ui** (Radix primitives), mobile-first, bottom tab bar, 44px targets.
  **TanStack Table** for the pantry table; **lucide-react** icons; **sonner** toasts.
- **Zod 4** at every boundary, including MCP tool inputs; **date-fns** for week and expiry maths.
- **Neon Auth (Managed Better Auth)** through `@neon/auth`: server proxy at `/api/auth`, browser client
  to the same origin, `src/proxy.ts` protecting every route except the auth views. Users and sessions
  live in the `neon_auth` schema on the same branch.
- **`pg` + `attachDatabasePool`** rather than the serverless driver, because Vercel Fluid compute keeps
  instances warm and the pool is released before the function suspends.
- **`@modelcontextprotocol/sdk`** over Streamable HTTP, **stateless** (no session ID, JSON responses),
  because Vercel functions don't hold long-lived SSE connections.
- **Vitest** on the conversion, deduction and leftover engine, with **PGlite** (0.5.16, real Postgres
  in WASM, in-process) for the SQL view and transaction tests; **Playwright** for the cook and tick
  flows.
- **Neon Local** (Docker proxy to a cloud branch) for everyday `pnpm dev`; **Neon branches** for CI
  and E2E. The schema is vanilla Postgres, so a plain `docker run postgres` works as a fallback.
- **Biome** for lint and format; GitHub Actions runs typecheck, Biome and Vitest.
- No AI SDK, no provider keys, no API calls to models in the deployed app.
- **All ledger rules live in `src/domain/`** as pure functions — plain rows in, entries-to-write out.
  Server actions persist the result inside one transaction. The database does `SUM()` and nothing
  else.

Versions as of November 2026: Next 16.4.6, React 19.3.1, TypeScript 7.0.2, Drizzle 0.45.4 /
drizzle-kit 0.31.11, Neon driver 1.2.1, Tailwind 4.3.5, Zod 4.6.7, jose 6.2.17, MCP SDK 1.32.2,
TanStack Table 9.3.1, Vitest 5.1.0, Playwright 1.65.1, Biome 2.6.8, pnpm 12.21.0.

**Runtime reality on Vercel.** Our server code is per-request Node functions, not a daemon. Full
Node.js API coverage, 300s max duration on Hobby, 4.5 MB request bodies, one region by default.
Consequences we design around: put the function region and the Neon project in the same region
(database round-trips dominate page latency), use Neon's pooled connection string with a small pool,
keep nothing in memory between requests, and treat Hobby cron as a daily safety net (once per day,
±59 min) rather than a scheduler — which is exactly why TickTick syncs on open.

## 3. Domain model

`user_id` exists on every table from day one, even though there is one user.

### Ingredient catalogue

| `ingredient` | |
|---|---|
| id, name, slug | canonical identity |
| category | produce, dairy, meat, dry, frozen, bakery, tins, other |
| aliases[] | "scallion" → spring onion, for import matching |
| stock_unit | the single unit this ingredient is counted in (g, ml, each, clove…) |
| grams_per (jsonb) | optional map of unit → grams, for crossing families: `{ "each": 150, "cup": 120 }` |
| shelf_life_days | seeded default; null = no date suggested |
| min_stock | optional low-stock threshold, in `default_unit`; the only way to flag `Low` when no plan is active |
| user_id | scoping |

Seed ~150 common ingredients with category + sensible shelf lives + aliases. Overrides are edits
to the row; no separate table. Unknown ingredients can be created inline from the pantry or the
adjust sheet, and inherit a category-based shelf life.

### The ledger

`stock_entry` is append-only and is the only place quantity lives.

| field | notes |
|---|---|
| id, user_id, ingredient_id | |
| quantity | signed, stored in the ingredient's base unit |
| unit_as_entered, quantity_as_entered | what you actually typed, for display |
| reason | `purchase` \| `cook` \| `adjust` \| `discard` |
| acquired_at | date (purchase, adjust-up) |
| best_before | date, optional; purchases and leftovers only |
| cook_event_id, shopping_item_id | provenance |
| note | free text, required for `adjust` that isn't a purchase |

- **Pantry balance** = `sum(quantity)` per ingredient, via a view. Never stored twice.
- **Pantry row** also derives: earliest `best_before` among entries with stock remaining, days
  until it, and a status (see §6.1).
- **Deduction is FEFO:** cooking consumes the oldest purchase entries first, writing one negative
  `cook` entry per consumed entry. A partial consume splits nothing — it writes a smaller negative
  amount against the oldest entry.
- **Rules live in TypeScript, not SQL.** `convert()`, `planDeduction()` (FEFO + shortfall),
  `scaleRecipe()`, `diffAgainstPantry()` and `splitLeftovers()` are pure functions over plain rows,
  unit-tested without a database. The only SQL in the ledger is `SUM()` for balances, plus one
  transaction per write.
- **Edits are entries too.** Correcting a typo writes an `adjust` entry; nothing is mutated or
  deleted. Reason lines are visible in an ingredient's history.
- **Manual use is an entry.** Cooking a recipe isn't required to consume stock: "Use up" on the
  pantry row writes an `adjust` (or `discard`) entry with the same FEFO behaviour.

### Recipes

| `recipe` | title, source_url, servings, prep_min, cook_min, steps (jsonb), tags[], image_url, created_by (`manual`\|`agent`), raw_jsonld |
|---|---|
| `recipe_ingredient` | recipe_id, ingredient_id (nullable), raw_text, quantity, unit, note, optional, sort_order, parse_status (`ok`\|`unmatched`\|\`count_only`) |

`steps` is an ordered array of `{ text, timer_min? }` so cook mode can render one step at a time and
offer a timer.

`ingredient_id` may be null for "a handful of parsley" or a line the parser couldn't resolve. A
recipe with unmatched lines can still be cooked — it just produces a manual prompt for those lines,
never a guess.

Deleting a recipe removes its planned entries and detaches cook history: `cook_events.recipe_id`
becomes null while `cook_events.recipe_label` keeps the dish's name, so the record of what you
actually cooked survives.

### Meal plan, cooking and leftovers

| `meal_plan` | user_id, week_start (date), status (`draft`\|`active`\|`archived`), created_by (`manual`\|`agent`), notes |
|---|---|
| `meal_plan_entry` | plan_id, day (date), slot (`lunch`\|`dinner`), kind (`recipe`\|`leftover`), recipe_id (null when leftover), leftover_id (null when recipe), servings, status (`planned`\|`cooked`\|`eaten`\|`skipped`), cook_event_id |
| `cook_event` | user_id, recipe_id, plan_entry_id (nullable), servings_cooked, eaten_now, cooked_at, shortfall_count |
| `leftover` | user_id, cook_event_id, recipe_id, servings, stored_at, best_before (default +3 days), status (`available`\|`reserved`\|`eaten`\|`discarded`), plan_entry_id (null when available) |

**Portions are the unit of a meal.** A recipe yields `recipe.servings` portions; a plan entry says
how many portions to make. Cooking 4 and eating 1 creates 3 leftover portions, which are
first-class records you can slot into any later lunch or dinner.

- A `leftover` entry **never deducts ingredients** — the deduction happened when it was cooked.
- Assigning a leftover to a slot moves it to `reserved`; eating it moves it to `eaten`. Unassigning
  returns it to `available`. Discarding it sets `discarded` and writes nothing to the pantry.
- Leftovers carry their own best-before (cooked_at + 3 days), independent of the ingredients.
- A **planned** leftover (no batch yet) must name a cook already on the plan. One portion of each
  cook is assumed eaten that night, so a 2-portion dinner offers 1 spare; cooking it twice offers 2.
  Cooking attaches the reservations to the new batch and subtracts them from its availability;
  eating one consumes the reservation, not a second portion. A planned leftover with no batch cannot
  be eaten.
- Breakfast is deliberately not in the enum yet; adding `breakfast` later is a one-line enum change.

Plans are **drafts until activated**. An agent can create a draft; only the user activates, edits or
marks meals cooked.

### Shopping

| `shopping_list` | user_id, name, status (`open`\|`done`), created_at |
|---|---|
| `shopping_item` | list_id, ingredient_id (nullable), label, quantity, unit, note, status (`pending`\|`ticked`\|`removed`), origin (`generated`\|`manual`), ticked_at, sort_order, ticktick_task_id, ticktick_project_id, resulting_stock_entry_id |

## 4. Units and conversion

Stored quantities are normalised to a base unit per family:

- **mass** → g (`kg`×1000, `oz`×28.35, `lb`×453.6)
- **volume** → ml (`l`×1000, `tsp`×5, `tbsp`×15, `cup`×240, `fl oz`×29.57)
- **count** → each (`clove`, `slice`, `bunch`, `can`, `pack` are distinct count units, not
  interchangeable)

Rules:

1. Within a family, always convert. Exact, no prompts.
2. Across families, convert **only** when the ingredient supplies a hint (`piece_grams`,
   `cup_grams`, `tbsp_grams`). 1 onion → 150 g yes; 1 onion → 200 ml no.
3. Otherwise **block**: "Recipe needs 200 g rice; pantry is counted in cups and this ingredient has
   no cup weight. Fix the unit?" The user resolves it once, and the hint is saved for next time.
4. Display in your chosen unit (metric default), independent of storage.

Named count units that frequently need to become mass (onion, garlic clove, carrot, egg) get a
`grams_per` entry seeded.

## 5. Core flows

### Shop → pantry

1. Tick an item → it is **purchase**d: writes a positive `stock_entry` with `acquired_at = today`,
   `best_before = today + ingredient.shelf_life_days`, and links the item to that entry.
2. The item then leaves the list. Unticking is only possible before the entry exists; after that you
   are looking at pantry history, not a list.
3. Removing or editing an unbought item touches the list only. **Shopping is the only inflow.**
4. Ticking is idempotent: replaying a tick returns the existing entry rather than adding twice.

### Plan → list

1. Consider only `planned` entries for the chosen week, both `recipe` and `leftover` kinds.
2. `leftover` entries contribute **zero** requirement — they're already cooked.
3. Sum requirements per ingredient, scaled by each entry's portions, converted to the pantry unit.
4. Subtract current pantry balance. Positive remainder = shortfall.
5. Write shortfall rows as `pending`, `origin = generated`.
6. "Refresh list" appends only what is *still* missing, never duplicates, never resurrects items you
   removed. `manual` items are never touched.

### Cook → deduct → leftovers

1. Open the entry's recipe in cook mode, scale ingredients by `servings / recipe.servings`.
2. On "Done cooking", ask two numbers: **portions cooked** (default = entry servings) and
   **portions eaten now** (default 1).
3. Deduct FEFO for the full cooked amount (not just the eaten portion), writing negative `cook`
   entries.
4. Short stock: show the exact gap, deduct what exists down to zero, record the shortfall on the
   `cook_event`, offer "add missing to list". Dismissing it still records the cook.
5. Unconvertible or unmatched ingredient lines are excluded and listed as "not tracked" — never
   guessed.
6. Remainder portions become `leftover` rows, available immediately in the leftover tray and
   assignable to any future lunch or dinner.
7. A `cooked` entry is terminal. Re-cooking requires an explicit confirmation and writes a new
   `cook_event`.

### Manual pantry adjustment

1. From any pantry row: **Add stock**, **Use up**, or **Discard**.
2. Add stock → `purchase` entry, `acquired_at = today`, best-before defaulted from shelf life,
   editable, or "no date".
3. Use up / Discard → negative entry, FEFO against oldest stock, with a reason note ("made soup",
   "mouldy").
4. The confirm sheet always previews the resulting total: `Rice 1.2 kg → 1.7 kg`.
5. Use up / Discard never push stock below zero; if you try, it clamps and tells you.

## 6. Screens

Five core surfaces. Everything is reachable in ≤2 taps from the bottom bar:
**Pantry · Plan · Shop · Recipes**, with cooking and adjustment as sheets over them.

### 6.1 Pantry table

The default landing screen. A dense, scannable table, not cards.

| Ingredient | In stock | Use by | Status |
|---|---|---|---|
| Rice | 1.2 kg | — | OK |
| Spinach | 200 g | Thu (2d) | Use soon |
| Eggs | 2 | — | Low |
| Olive oil | 0 ml | — | Out |

- **The default view is stock, not catalogue.** Ingredients at zero are hidden behind the `All` tab;
  an empty pantry says so and offers one tap to reveal the catalogue and add something.
- **Grouped by category**, collapsible; default sort by severity (Out → Low → Use soon → OK), then
  days to expiry, then name.
- **Status is derived on read, never stored.** The flags are independent, and a row shows at most
  two chips:
  - `Out` — total ≤ 0.
  - `Use soon` — stock > 0 and earliest best-before ≤ 3 days.
  - `Low` — either the remaining planned *recipe* meals this week need more than the pantry holds,
    or total ≤ `min_stock` when a minimum is set. `leftover` entries add no requirement, and a meal
    already marked cooked no longer counts.
  - `OK` — none of the above.
- **Sort order:** `Out` → `Use soon` → `Low` → `OK`, then days to expiry, then name. An ingredient
  that is both `Use soon` and `Low` shows both.
- **Without an active plan, only `min_stock` can raise `Low`** — the plan-aware half needs a plan to
  compare against. This is why the minimum is optional rather than required: it's the fallback, not
  the primary signal.
- **Filters:** `In stock` (default), `Running out` (low now, turning, or ran out in the last week —
  not everything you have never bought), and `All`, plus a text search that matches name and aliases.
- **Row tap** opens the ingredient sheet: total, history entries newest-first (who, when, why),
  best-before queue, unit hints, `min_stock`, and the Add/Use up/Discard actions.
- **Edit** changes how the ingredient is counted. Existing ledger rows are converted, not relabelled:
  mass and volume keep their base units, while counted units are bridged through grams and the
  change is refused if no weight is supplied.
- **"What am I running out of"** is the `Low` + `Out` filter, one tap from the table header.
- Empty state offers "Add your first ingredient" and "Generate list from plan" if a plan exists.

### 6.2 Recipe cook mode (mobile)

The reason the phone exists. One screen, no chrome.

- Header: recipe title, total time, a servings stepper that rescales ingredient amounts live.
- Ingredients list with `need / have` per line: `200 g rice · have 1.2 kg`. Short lines are amber,
  untracked lines greyed with "not tracked".
- Steps rendered one at a time with a large type scale, swipe or tap to advance, step counter,
  checkmarks persisted so you can put the phone down. Steps with `timer_min` get a start-timer
  button (screen-wake lock).
- A persistent bottom bar: **Done cooking**.
- "Done cooking" opens the cook sheet: portions cooked, portions eaten now, shortfall warnings if
  any, then a deduction summary (`Rice 1.2 kg → 1.0 kg`) and "3 portions of chilli saved as
  leftovers".
- Cook mode is also reachable straight from a recipe page, independent of the plan.

### 6.3 Week plan

A weekly view, **lunch and dinner per day**, seven days.

- Phone: vertical list, one card per day, two slots each.
- Desktop: seven columns, two rows.
- Each slot is one of: empty, `recipe` (dashed border), `cooked` (solid, ticked), `leftover`
  (distinct left-arrow icon plus the dish name), `skipped` (struck through).
- **Add meal** on any slot: search the recipe library, pick from recent recipes, or pick an
  available leftover. Adding a recipe entry asks for portions, defaulting to the recipe yield.
- **Manual plan creation is a first-class path:** pick any week, add entries by hand. No agent, no
  draft state.
- Header actions: **Generate shopping list** (runs §5 Plan → list for this week), **Ask an agent**
  (shows the MCP URL and the skill command — a handoff, not an embedded chat), and week navigation.
- Agent-authored plans arrive as `draft` with a banner: "Draft from <agent> · Activate · Discard",
  plus a per-entry confirm. Nothing is live until you activate it.
- Cooked entries show what they left behind: "2 portions left over".

### 6.4 Leftover tray

A dismissible strip at the top of the plan, and a full list under Recipes → Leftovers.

- One row per leftover batch: dish, portions, cooked date, use-by countdown, amber at ≤1 day.
- Tap → "Put in a slot" (opens the week picker filtered to empty/planned slots) or "Discard".
- Portions are divisible: 3 portions can go 2 into Wednesday lunch and 1 into Thursday dinner,
  creating two entries against one leftover batch.
- Leftovers appear in plan→list as free meals, so generating a list doesn't buy ingredients you've
  already cooked.

### 6.5 Shopping list

- Flat list, grouped by category, large tap targets, one tap to tick, swipe to remove.
- Quantity shown as `2 kg`; "Tick all" and "Add item" at the bottom.
- Generated rows carry a small "from plan" tag; manual rows don't.
- Ticking writes the purchase and the row slides away. Undo toast for 5 seconds **before** the
  purchase commits; after that, corrections happen in the pantry.
- When TickTick is connected, a "Synced" line and a manual "Sync now" appear at the top.
- Reading it offline shows the last cached list with a banner; ticking requires a connection until
  the M4 offline queue lands.

### 6.6 Recipes

- Library grid/list with search, tags, time filters, and a "can cook now" filter (everything in
  stock).
- Recipe page: ingredients with have/need, steps, source link, "Cook this", "Add to plan".
- Recipe with unmatched ingredient lines shows a "3 lines need a look" chip that opens the fix-up.

## 7. AI seam (M2)

**Status:** the read-only half is live, plus a draft writer. `/api/mcp` speaks stateless Streamable
HTTP with JSON responses, authenticated by a single `LARDER_MCP_TOKEN` bearer token (rotate the env
var to revoke). The served skill and setup prompt are public documents; the MCP endpoint
authenticates itself and is listed as public in `src/proxy.ts`.

Tools shipped: `list_pantry`, `expiring_soon`, `list_leftovers`, `get_week_plan`, `search_recipes`,
`get_recipe`, `propose_shopping_list`, `list_ingredients`, `create_ingredient`, `create_recipe`,
`create_meal_plan`. Recipe writes are validated against the catalogue and refuse unconvertible
units rather than guessing; the agent is instructed to present an online recipe, with its source,
and wait for approval before calling `create_recipe`. Plans are written only as drafts
(`meal_plans.status = 'draft'`, entries marked `created_by = 'agent'`); the Plan tab shows a banner
to activate or discard, and discard removes only agent entries. Cooking and stock changes stay
human-only.

The agent on-boarding mirrors Neon's pattern: `/agent-setup` renders copyable prompts (with the
token), `/prompts/agent-setup.md` is a public machine-readable version, and
`/skills/larder-planner/SKILL.md` is the planner brief an agent pulls and saves.

### MCP server

`/api/mcp`, Streamable HTTP, bearer-token auth, one token per agent, revocable.

| tool | behaviour |
|---|---|
| `list_pantry` | balances, units, earliest best_before, days left, status; optional query filter |
| `expiring_soon` | ingredients by urgency, with amounts |
| `list_leftovers` | available portions, dish, cooked date, use-by |
| `get_week_plan` | entries for a week, kinds, statuses, portions |
| `search_recipes` | by text, tags, time, "uses these ingredients" |
| `get_recipe` | full structured recipe incl. unmatched lines |
| `import_recipe` | URL → server fetches, reads JSON-LD, parses lines, resolves ingredients, returns a **draft**; never saves without `create_recipe` |
| `create_recipe` | validated write, rejects unresolvable units |
| `create_meal_plan` | week + entries → **draft** plan; rejects missing recipes, validates day/slot |
| `update_meal_plan` | edits a draft |
| `propose_shopping_list` | diff plan vs pantry, returns proposed rows; writes only when asked |

Deliberately absent: `cook_meal`, `tick_item`, `adjust_stock`, `delete_*`. An agent may plan; the
human confirms consumption. Destructive or irreversible operations are not exposed over MCP.

### Instructions the agent pulls

Two layers:

1. **MCP `initialize.instructions`** — a short, always-present brief: the ledger rules, the unit
   families, "plans are drafts", "never invent a conversion", "prefer expiring stock", "leftovers
   are free meals — check them before proposing new ones".
2. **`/skills/larder-planner/SKILL.md`** — versioned, public, pulled into
   `.opencode/skills/larder-planner/SKILL.md` or fetched live. Contains the domain model, the tool
   workflow (read pantry → check expiring → check leftovers → search library → import only what's
   needed → draft plan → summarise → wait for activation), conversion rules, and worked examples of
   a good plan and a good "use it up" argument.

The skill ships with the app so it can never drift from the schema: its version is stamped in the
file, and it names the schema version it targets.

### Recipe import (no AI required)

Server-side fetch → `application/ld+json` Recipe extraction → deterministic ingredient-line parser
(`qty unit name, note`) → alias matching against the catalogue → `parse_status` per line. Ambiguous
lines are surfaced for one-tap fixing. AI is the fallback for stubborn sites, not the default.

## 8. TickTick (M3)

`ShoppingListProvider` interface: `push(list)`, `pullCompletions(list)`, `reconcile()`.

- One TickTick project, "Larder shopping"; one task per list item, `Rice — 2 kg`.
- Push on list change; store `ticktick_task_id` per item.
- Pull on app open, on manual "Sync", and on a cron. **Hobby crons run once a day**; frequent sync
  needs Pro, so sync-on-open is the primary path and cron is the safety net.
- A completed task → purchase entry → item marked `ticked`, task left completed in TickTick.
  Reconciliation is keyed on `resulting_stock_entry_id` so a re-poll cannot double-add.
- Edits are one-way (Larder → TickTick). No two-way merge, no conflict resolution, one place to
  change things.

## 9. Auth and security

- One passphrase was the original plan; **Neon Auth (Managed Better Auth)** replaced it once the
  project had an auth-capable database. Email + password today; social OAuth and magic links are
  branch settings, not code changes.
- **One account, sign-up closed.** The auth branch has `disable_sign_up` set, so the auth server
  refuses new users — the sign-in form has no sign-up path, and the endpoint returns 400 regardless.
  Adding a second person later is an admin action (`neon neon-auth user create`) or a deliberate
  household invitation flow, never an open registration page.
- `src/proxy.ts` redirects signed-out requests to `/auth/sign-in`; `/api/auth` and the auth views are
  public, everything else is protected. Proxy is a convenience, not the security boundary — route
  handlers and server actions re-check `auth.getSession()` before touching data.
- The app's `users` row links to the auth user via `auth_user_id`. The first sign-in adopts the
  seeded single-user row, so the 119-ingredient catalogue belongs to whoever signs up first.
- MCP tokens are separate, scoped, and revocable; they cannot create purchases, cook meals, or
  adjust stock.
- All writes go through server actions / route handlers with Zod validation and `user_id` scoping.
- No database credentials in the browser, ever.
- Audit log table for ledger writes: actor (`user` \| `mcp:<token name>`), action, before/after.

## 10. Non-goals

Multi-user households (schema is ready, no UI), prices and budgets, barcode scanning, nutrition,
recipe sharing, native apps, breakfast planning, real offline outbox (tick endpoint is idempotent so
it can be added), AI inside the web app.

## 11. Milestones

**M1 — The ledger and the phone loop (build this first).** Schema + seed catalogue, Neon Auth sign-in,
pantry table with statuses and history, adjust sheet (add / use up / discard), manual recipe entry,
cook mode with step checkmarks and timer, manual week plan with lunch and dinner, leftover portions
and the tray, generate list from plan, tick → purchase, cook → FEFO deduction with shortfall
handling. Unit + deduction + leftover tests green. No AI, no TickTick.

**M2 — Agents.** MCP server + tokens + audit log, served `SKILL.md`, JSON-LD import with parser and
fix-up UI, draft-plan activation flow.

**M3 — TickTick.** Provider interface, push/poll/reconcile, sync-on-open + daily cron.

**M4 — Comfort.** Installable PWA shell, idempotent offline queue, household invites, report views
(waste, spend, most-cooked), leftover expiry nudges.

## 12. Open questions

- Week starts Monday; is Sunday-dinner planning part of the same week?
- Leftovers default to 3 days — should that be per-recipe (rare steak vs soup)?
- Imperial display for loose recipes that arrive in cups — convert and show metric, or preserve?
- Do skipped meals matter enough to record, or should skipping just delete the entry?
