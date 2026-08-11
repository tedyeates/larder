# Agent Gateway MCP surface

An Agent Runner calls `POST /api/mcp` with its own **Agent Token**. It never receives a Supabase anon key, service-role key, or database connection string. Agent Tokens begin `agt_`, are generated in Settings, displayed once, and are revocable immediately.

## Authentication

Every JSON-RPC request, including `initialize` and `tools/list`, needs:

```http
Authorization: Bearer agt_<secret-shown-once>
Content-Type: application/json
```

No token, a malformed token, and a revoked token return HTTP `401` with JSON-RPC error code `-32001`. The response never distinguishes an unknown secret from a revoked one.

The app hashes the secret before lookup, resolves its owner server-side, then executes the tool in a database session with that user’s `authenticated` role and claims. Existing RLS policies therefore still scope every read. `DATABASE_URL` exists only on the app server; it is never a Runner environment value.

## Transport

This is MCP Streamable HTTP over JSON-RPC 2.0. Supported methods:

- `initialize` — returns protocol version, server name, and tool capability.
- `tools/list` — returns tool metadata and JSON input schemas.
- `tools/call` — requires `params.name` and optional `params.arguments`.

`tools/call` returns standard MCP `content` plus identical `structuredContent`, so a Runner can use structured data without reparsing text.

```sh
curl -sS "$LARDER_URL/api/mcp" \
  -H "Authorization: Bearer $LARDER_AGENT_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

curl -sS "$LARDER_URL/api/mcp" \
  -H "Authorization: Bearer $LARDER_AGENT_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"larder_read_current_meal_slots","arguments":{}}}'
```

## Tools

| Tool | Scope | Structured response |
|---|---|---|
| `larder_list_recipes` | read | `recipes`: Recipes with Tags and ordered Lines |
| `larder_read_pantry` | read | `pantry`: Pantry totals by Ingredient and Storage Location |
| `larder_read_meal_stock` | read | `mealStock`: Meal Stock totals by Recipe or labelled ready meal |
| `larder_read_meal_log` | read | `mealLogEntries`: Meal Log, record of what was actually eaten |
| `larder_list_preferences` | read | `preferences`: stated leanings to reason with |
| `larder_read_current_meal_slots` | read | `mealSlots`: today/future Meal Slots, Cookable and Shortfall state |
| `larder_create_preference` | write | `preference`; input `{ "body": string, "category"?: string \| null }` |
| `larder_update_preference` | write | `preference`; input `{ "id": string, "body"?: string, "category"?: string \| null }` |
| `larder_delete_preference` | write | `deletedPreferenceId`; input `{ "id": string }` |
| `larder_submit_plan_proposal` | write | Plan Check result; input complete proposal bundle plus optional `proposalId` for resubmission |

Preference tools and `larder_submit_plan_proposal` are the only writes in this version. A Runner can submit or resubmit a reviewable proposal, but it cannot confirm one or write Stock Lots, Portion Batches, Meal Log entries, Shopping Items, Recipes, or Meal Slots directly. An undocumented or forbidden name returns HTTP `403` and JSON-RPC error code `-32003`; the route never accepts arbitrary SQL, RPC names, table names, or client-supplied write paths.

The Pantry and Meal Stock outputs are summaries. They intentionally do not expose individual Stock Lots or Portion Batches.

## Minting and revocation

Use **Settings → Agent Tokens** in the authenticated app. Mint requires a label; copy the displayed secret into the Runner’s private environment immediately. The Settings API only lists token metadata, never secrets. Revoke from the same panel; the next MCP request with that secret fails authentication.
