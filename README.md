# Larder

A meal planning and kitchen inventory app. AI proposes meal plans; everything downstream of your
approval is deterministic. The Meal Plan is a guide — the Pantry is reality.

See [CONTEXT.md](./CONTEXT.md) for the domain glossary and [docs/adr](./docs/adr) for
architecture decisions.

## Stack

- Next.js (App Router) + React + TypeScript, deployed on Vercel
- Supabase (Postgres) for data and auth — state transitions live in Postgres functions called via
  Supabase RPC, shared by the UI and the MCP
- Vitest for unit tests, pgTAP for Postgres state-transition tests, Playwright for e2e
- Optional Agent Runner container hosting the planning AI (see
  [docs/adr/0002-ai-optional-agent-runner.md](./docs/adr/0002-ai-optional-agent-runner.md))

## Prerequisites

- Node.js 22
- [pnpm](https://pnpm.io/) (via `corepack enable`)
- [Docker](https://docs.docker.com/get-docker/) (for local Supabase and/or `docker compose`)
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)
  (`npx supabase` works with no global install)

## Setup

1. Install dependencies:

   ```sh
   pnpm install
   ```

2. Start local Supabase:

   ```sh
   npx supabase start
   ```

   This runs a local Postgres, applies migrations in `supabase/migrations`, and seeds
   `supabase/seed.sql`. On first run it prints an API URL and anon key — note them for step 3.
   Default local ports (from `supabase/config.toml`):

   | Service | Port |
   |---|---|
   | API | 54331 |
   | DB | 54332 |
   | Shadow DB | 54320 |
   | Pooler | 54329 |
   | Studio | 54323 |

3. Copy `.env.example` to `.env` and fill in the values:

   ```sh
   cp .env.example .env
   ```

   - `NEXT_PUBLIC_SUPABASE_URL` — local API URL from step 2 (`http://127.0.0.1:54331` for the
     ports above; `.env.example` currently ships `54321`, the Supabase CLI default — check what
     `npx supabase start` actually prints for your machine).
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` — anon key printed by `npx supabase start`.
   - `LARDER_AGENT_TOKEN` — only needed if running the Agent Runner (see below). Mint one from
     **Settings → Agent Tokens** in the running app.
   - `KIRO_API_KEY` — only needed if running the Agent Runner. Authenticates kiro-cli headlessly
     inside the Runner container, skipping interactive browser login.

## Running the app

Web app only, against local Supabase:

```sh
pnpm dev
```

Opens at [http://localhost:3000](http://localhost:3000). The Planner UI is hidden unless
`AGENT_RUNNER_URL` is set — the app works standalone without the Agent Runner.

### With the Agent Runner (planning AI)

The Agent Runner is a separate container that talks to the app over MCP; it never gets direct
database access. Full contract in [docs/agent-runner.md](./docs/agent-runner.md) and
[docs/agent-gateway-mcp.md](./docs/agent-gateway-mcp.md).

```sh
docker compose up --build
```

This builds and starts both `app` (port 3001 on the host) and `agent-runner` (port 8080, bound to
localhost).
Requires `LARDER_AGENT_TOKEN` and `KIRO_API_KEY` set in `.env` first.

## Testing

```sh
pnpm test          # unit tests (Vitest), one-off
pnpm test:watch    # unit tests, watch mode
pnpm e2e           # Playwright e2e
npx supabase test db  # pgTAP suite — needs local Supabase running (npx supabase start)
```

pgTAP runs on the host rather than in a container because it needs the local Supabase instance.

## Other checks

```sh
pnpm check   # tsc --noEmit
pnpm lint    # eslint
pnpm build   # next build + service-role-key bundle check
```

## Security note

`.env` holds real secrets (Supabase anon key, Agent Token, and `KIRO_API_KEY`). Never commit it —
it's already covered by `.gitignore`. The Agent Runner never receives the Supabase service-role
key, a database URL, or browser cookies; it only ever holds an Agent Token and `KIRO_API_KEY`
scoped through the app's MCP surface.
