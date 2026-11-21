# Deploying Larder

Neon for Postgres and auth, Vercel for the app. This is the path that has actually been run in this
repo, including the traps.

- **Neon region:** `aws-eu-west-2` (London).
- **Vercel region:** `lhr1`, to match. A mismatch adds ~90 ms to every query.
- **Runtime:** Node functions, not Edge. The `pg` pool needs it.
- **Sign-up:** disabled on the auth branch; one account, created once.

---

## 1. Neon project

If you already have the project (`noisy-sea-25551885`, branch `production`), skip to step 2.

```bash
neon projects create --name larder --region-id aws-eu-west-2
neon link --project-id <project-id>
```

If your CLI's region list doesn't show `aws-eu-west-2`, create the project from the console and
choose **London**; then `neon link` it. The CLI help has lagged behind the available regions.

`neon link` writes `.neon`, which pins the project and branch for every later command. It is
gitignored because it is machine-specific.

### Connection strings

Neon gives two for the same database:

| Variable | Endpoint | Used by |
|---|---|---|
| `DATABASE_URL` | pooled (`-pooler` host) | the app at runtime |
| `DATABASE_URL_UNPOOLED` | direct | `drizzle-kit` migrations |

Migrations must use the direct string: PgBouncer's transaction mode can't carry DDL. The app
rewrites `sslmode=require` to `verify-full` in code, so Neon's default strings work as-is.

### Auth

```bash
# enabled once, declared in neon.ts as auth: true
neon deploy

neon neon-auth status
neon neon-auth config email-password update --disable-sign-up true
neon neon-auth config email-password get      # confirm Disable Sign Up: true
```

Managed Better Auth lives in the `neon_auth` schema on the same branch. No separate service.

### Schema and catalogue

```bash
corepack pnpm install
corepack pnpm db:migrate    # uses DATABASE_URL_UNPOOLED
corepack pnpm db:seed       # 120-ingredient catalogue, idempotent
```

Both are safe to re-run. Seeding matches on `(user_id, slug)`.

### Local environment

```bash
neon env pull --file .env.local
```

Then add the two application secrets Neon does not inject:

```bash
# 32 random bytes, base64
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64'))"
# → NEON_AUTH_COOKIE_SECRET=...

# MCP bearer token
node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('base64url'))"
# → LARDER_MCP_TOKEN=...
```

Full list:

| Variable | Source | Notes |
|---|---|---|
| `DATABASE_URL` | `neon env pull` | pooled |
| `DATABASE_URL_UNPOOLED` | `neon env pull` | direct, migrations only |
| `NEON_AUTH_BASE_URL` | `neon env pull` | per branch |
| `NEON_AUTH_JWKS_URL` | `neon env pull` | per branch |
| `NEON_AUTH_COOKIE_SECRET` | you generate | 32+ bytes; rotating signs everyone out |
| `LARDER_MCP_TOKEN` | you generate | bearer for `/api/mcp`; rotating revokes agents |

---

## 2. First account

Sign-up is closed by default, so bootstrap deliberately:

1. `neon neon-auth config email-password update --disable-sign-up false`
2. Open `/auth/sign-in`, choose **Claim the larder**, create the account.
3. `neon neon-auth config email-password update --disable-sign-up true`
4. Confirm the auth user count is 1.

The first sign-in adopts the seeded `users` row, so the catalogue belongs to you rather than being
orphaned. There is no UI to create a second account; that's intentional.

---

## 3. Vercel

### Import

1. Push the repo to GitHub.
2. **Vercel → Add New → Project → Import**.
3. Framework preset: **Next.js**. Root directory: repo root. Build: `pnpm build` (auto-detected
   from `packageManager`).
4. **Settings → Functions → Region: London (`lhr1`)**.
5. Node version: **24.x** if offered; the app is developed on Node 24.

### Environment variables

Set these for **Production** (and Preview only if you follow the preview-branch section):

```bash
corepack pnpm dlx vercel link
corepack pnpm dlx vercel env add DATABASE_URL production
# repeat for each; or paste them in the dashboard
```

Values come from your local `.env.local`. Do **not** run migrations from the build step — a failed
deploy would leave the schema half-applied. Migrate from your machine against the direct URL:

```bash
corepack pnpm db:migrate
```

### Auth domain

The auth server refuses redirects to origins it does not trust:

```bash
neon neon-auth domain add https://<your-app>.vercel.app
neon neon-auth domain list
```

Localhost is pre-approved, which is why dev works without this step.

### MCP

`/api/mcp` is public to the proxy and authenticates with the bearer token itself. Nothing extra to
deploy. After the first deployment, check it:

```bash
curl -s -X POST https://<your-app>.vercel.app/api/mcp \
  -H "Authorization: Bearer $LARDER_MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
```

Expect `serverInfo` with `"name":"larder"`. `401` means the token is wrong; `503` means
`LARDER_MCP_TOKEN` isn't set on that deployment.

---

## 4. TickTick sync

Larder can push the open shopping list to a TickTick list and pull completed
tasks back into the pantry. It uses TickTick's OAuth app flow; no API key is
stored in Vercel.

1. Create an app at <https://developer.ticktick.com/>.
2. Add this redirect URI exactly:
   `https://<your-app>.vercel.app/api/integrations/ticktick/callback`
   (use `http://localhost:3000/api/integrations/ticktick/callback` locally).
3. In Larder, open **Shop → Set up → TickTick sync**.
4. Paste the client ID and secret, save, then **Connect TickTick**.
5. Choose the list and press **Sync now**.

The client secret and OAuth tokens are stored in the `ticktick_settings` table
and never sent back to the browser. Pending shopping items become TickTick
tasks; ticking one in TickTick and syncing adds that stock to the pantry.

---

## 5. Post-deploy checklist

| Check | Expected |
|---|---|
| `/auth/sign-in` signed out | 200 |
| `/pantry` signed out | 307 → `/auth/sign-in` |
| Sign in | lands on `/pantry` |
| `db:seed` ran | Pantry shows 120 ingredients at zero |
| `/api/mcp` with token | `initialize` returns `larder` |
| `/api/mcp` without token | 401 |
| `/skills/larder-planner/SKILL.md` | 200, markdown |
| `/prompts/agent-setup.md` | 200, markdown |
| Sign-up attempt | 400 (disabled at the branch) |

---

## 6. Preview deployments (optional)

Each Neon branch gets its own database **and its own auth URL**, so previews need their own
variables, not production's:

1. `neon branches create --name preview` (or one branch per PR).
2. Enable auth on that branch (`neon deploy` applies `neon.ts`).
3. Pull its variables into a file: `neon env pull --branch preview --file .env.preview`.
4. Add them to Vercel's **Preview** environment.
5. Trust the preview origin: `neon neon-auth domain add https://<preview-url>`.

Until you do this, either disable preview deployments or accept that previews talk to production —
which you should not accept, because a preview sign-in writes real sessions.

---

## 7. Rotating secrets

| Secret | Effect |
|---|---|
| `LARDER_MCP_TOKEN` | all agents disconnect until updated; app users unaffected |
| `NEON_AUTH_COOKIE_SECRET` | all sessions invalidated; everyone signs in again |
| Neon role password (`neon roles reset-password`) | update both database URLs |

Change the value in Vercel, redeploy, then update `.env.local` and `opencode.json`.

---

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `invalid domain` on sign-in | origin not trusted on the branch | `neon neon-auth domain add https://…` |
| 401 from `/api/mcp` | wrong/missing bearer | check `LARDER_MCP_TOKEN` |
| 503 from `/api/mcp` | token unset on that deployment | add the env var and redeploy |
| `prepared statement already exists` | migration ran over the pooled URL | use `DATABASE_URL_UNPOOLED` |
| Every page slow after idle | Neon compute woke from scale-to-zero | first request only; ~300 ms |
| MCP tools missing in OpenCode | config used `mcp.<name>` instead of `mcp.servers.<name>` | fix `opencode.json`; it reloads without restart |
| TickTick says redirect URI is invalid | the URI in the TickTick app differs from `/settings/ticktick` | copy it exactly, including scheme and host |
| TickTick sync returns 401 | access token expired or revoked | open the TickTick settings and **Reconnect TickTick** |
| Sign-up form rejected | branch has sign-ups disabled | admin-create or temporarily re-enable |
