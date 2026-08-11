# Agent Runner contract

`AGENT_RUNNER_URL` is an app-server-only URL. When unset, `/planner` renders no UI, Planner is omitted from navigation, and `POST /api/planner` returns `404 {"error":"Planning is unavailable on this deployment."}`. No browser receives Runner address or Agent Token.

## HTTP contract

Any container can replace kiro-cli when it implements one endpoint:

```http
POST /v1/chat
Accept: text/event-stream
Content-Type: application/json

{
  "message": "Plan dinners through Friday",
  "planningHorizon": "2026-08-16",
  "conversationId": "optional-stable-chat-id",
  "proposalId": "optional-id-for-a-rejected-proposal"
}
```

`message` is required. `planningHorizon` is normally sent by chat and is `YYYY-MM-DD`. `proposalId` identifies a rejected proposal to revise and resubmit. Return `200 text/event-stream`; relay preserves events without buffering:

```text
event: token
data: {"text":"I can use the chickpeas"}

event: proposal
data: {"proposalId":"5fb8..."}

event: done
data: {}
```

`token` may occur many times and is appended directly in UI. Emit `proposal` after MCP accepts a Plan Proposal. Emit `error` with `{"error":"clear message"}` for model/runtime failures, followed by `done`. Non-2xx responses make app show a clear Runner error. Runner does not receive browser cookies, Supabase keys, service-role keys, or a database URL.

## Local setup

1. Mint an **Agent Token** in Settings and put it in private `.env` as `LARDER_AGENT_TOKEN`.
2. Set `KIRO_API_KEY` in `.env` — this authenticates kiro-cli headlessly inside the Runner, skipping interactive browser login.
3. Set app Supabase public variables in `.env`, then run `docker compose up --build`.

Compose injects `AGENT_RUNNER_URL=http://agent-runner:8080` only into app. Runner receives `LARDER_URL=http://app:3000` and its Agent Token. It calls app MCP at `/api/mcp`; it has no database network configuration or credentials.
