# Research: Driving kiro-cli 2.16.2 headless from a Next.js route handler

Date: 2026-08-11
Question: How is `kiro-cli` 2.16.2 driven headlessly from a route handler, and how does its output reach the browser? (GitHub #32, map #25)

Method: empirical runs on this machine (`kiro-cli 2.16.2`, `/home/ted_y/.local/bin/kiro-cli`) plus kiro.dev primary docs. v1's `--agent-file`, `--mcp-config`, `--output-format stream-json` (`agent-runner/server.mjs` on `feature/prd-1`) are all gone; the shape below is what 2.16.2 actually exposes.

## 1. Exact command for one planning turn

`kiro-cli chat --help` shows the surviving flags: `--no-interactive`, `--agent <AGENT>`, `--trust-tools <TOOL_NAMES>`, `--resume-id <SESSION_ID>`, `--model`, `--effort`, `--require-mcp-startup`. There is **no** `--prompt` flag — the prompt is the positional `[INPUT]` argument.

Verified run (non-TTY, stdout piped to a file):

```
$ kiro-cli chat --no-interactive --trust-tools= 'reply with the single word pong'
> pong          # exit 0
```

Recommended planning-turn invocation (env carries auth, see §5):

```bash
KIRO_API_KEY=… kiro-cli chat \
  --no-interactive \
  --agent larder-planner \
  --trust-tools=@larder \
  --require-mcp-startup \
  [--resume-id "$SESSION_ID"] \   # omit on the first turn of a conversation
  "$PROMPT"
```

Source: `kiro-cli chat --help` (this machine); https://kiro.dev/docs/cli/headless/

## 2. Where agent definitions live; how MCP is configured

`--agent-file` is gone. Agents are now **named JSON configs**, discovered by `--agent <name>`:

```
$ kiro-cli agent list
Workspace: ~/projects/larder/.kiro/agents
Global:    ~/.kiro/agents
```

So a Larder planner agent lives at `.kiro/agents/larder-planner.json` (workspace) or `~/.kiro/agents/*.json` (global). Schema (from `~/.kiro/agents/implementer.json`, `pr-security.json`, `kirocrew.json`): `name`, `description`, `prompt` (`"file://…md"` — replaces `--agent-file`), `model`, `tools` (allow-list of tool names the agent *has*), `allowedTools` (auto-approved subset), `toolsSettings`, `resources`, and **`mcpServers`**.

MCP is configured **inside the agent JSON** under `mcpServers` (same object v1 put in `mcp.json`), or globally in `~/.kiro/mcp.json`, or via `kiro-cli mcp add`. `kiro-cli mcp list` confirms servers resolve per-agent:

```
$ kiro-cli mcp list
🌍 global:
  kirocrew
    • kirocrew-core /home/ted_y/.kiro/crew-venv/bin/kirocrew
```

`kirocrew.json` embeds `"mcpServers": { "kirocrew-core": { "command": …, "args": […] } }` and `"includeMcpJson": false`. v1's streamable-http block (`type: streamable-http`, `url`, `headers.Authorization`) drops straight into this `mcpServers` map.

Source: `kiro-cli agent list`, `kiro-cli mcp list`, `kiro-cli mcp add --help` (this machine); `~/.kiro/agents/*.json`

## 3. Non-TTY stdout and SSE streaming

There is **no machine-readable stream format** in 2.16.2 — `--output-format`/`stream-json` do not exist. Piped stdout is the rendered assistant text with a `> ` prefix and ANSI colour codes; credits/timing go to **stderr**:

```
stdout: \x1b[38;5;141m> \x1b[0mpong
stderr: ▸ Credits: 0.10 • Time: 2s
```

Cleanest SSE approach (keep v1's server shape, drop the JSON parsing): `spawn` the process per turn, read `child.stdout` incrementally, strip ANSI, and emit each chunk as an SSE `token` event; emit `done` on `close`. Structured signals should use an in-band sentinel exactly as v1 did (`PLAN_PROPOSAL_ID: <uuid>` on its own line, regex-extracted before forwarding) — there is no tool-call JSON channel to rely on. Set `--wrap never` for raw output.

Source: `/tmp/pong.out` / `/tmp/pong.err` (this machine); `kiro-cli chat --help` (`--wrap`, no `--output-format`)

## 4. `--resume-id` multi-turn continuity

Reliable and verified across separate processes. Turn 1 stored a fact, turn 2 (new process, `--resume-id`) recalled it:

```
$ kiro-cli chat --no-interactive --trust-tools= 'Remember the secret number is 42. Reply only: ok'
> ok
$ kiro-cli chat --no-interactive --resume-id a8b16b22-… --trust-tools= 'What was the secret number?…'
> 42
```

Session ids come from `kiro-cli chat --list-sessions -f json` (array of `{cwd, sessions:[{sessionId, source, title, updatedAt, messageCount}]}`); capture the newest `sessionId` right after the first turn and persist it against the conversation. **v1's manual history replay should die** — the CLI owns transcript state now.

Source: resume test + `kiro-cli chat --list-sessions -f json` (this machine)

## 5. Authentication for a server process

Headless auth uses the **`KIRO_API_KEY`** environment variable — no browser, no interactive login, and (per docs) no session-expiry concern for the key itself. The API key is generated from the Kiro portal (app.kiro.dev) and requires a Pro/Pro+/Pro Max/Power subscription; admin governance rules apply to headless sessions. This is the correct path for the local desktop planner process.

```
kiro-cli chat --no-interactive --trust-tools=read,grep "…"   # with KIRO_API_KEY set
```

Interactive login (`kiro-cli login`, `--use-device-flow` for no-browser hosts; Builder ID / Identity Center / social) caches a token at `~/.aws/sso/cache/kiro-auth-token.json` (file present on this machine — contents not read). That token *can* expire and needs refresh/re-login, so `KIRO_API_KEY` is preferred for an unattended server. Never commit the key; store it as a secret and rotate.

Source: https://kiro.dev/docs/cli/headless/ ; https://kiro.dev/changelog/cli/2-0/ ; `kiro-cli login --help`; `ls ~/.aws/sso/cache` → `kiro-auth-token.json` (this machine)

## 6. Scoping tools so the planner cannot write files or run shell

Two mechanisms, use both:

- **Agent config allow-list (authoritative).** In `larder-planner.json`, set `tools` to *only* the MCP surface and omit `fs_write`/`execute_bash` entirely, so those tools do not exist for the agent (mirrors `pr-security.json`, whose `tools`/`allowedTools` exclude `write`). This survives regardless of CLI flags.
- **`--trust-tools` at spawn.** `--trust-tools=` (empty) trusts nothing; a value trusts only that set. MCP tools are namespaced — the CLI warned: `--trust-tools arg for custom tool … needs to be prepended with @{MCPSERVERNAME}/`. So trust the Larder server tools as `@larder/<tool>` (e.g. `--trust-tools=@larder/larder_submit_plan_proposal,@larder/…`). Built-ins like `fs_write`/`execute_bash`, left out of both the agent `tools` list and `--trust-tools`, cannot run — and under `--no-interactive` there is no prompt to approve them, so an untrusted call is blocked rather than executed.

Do **not** use `--trust-all-tools` for the planner.

Source: `kiro-cli chat --help` (`--trust-tools` example); stderr warning from the empty-trust run; `~/.kiro/agents/pr-security.json` (this machine); https://kiro.dev/docs/cli/headless/ (best practice: prefer `--trust-tools` least-privilege)

## 7. Concurrency, cost, timeouts

A trivial turn reported `Credits: 0.10 • Time: 2s` (stderr). Cost/latency is dominated by model generation, not process spawn. Because `--resume-id` reconstructs conversation state from disk, you do **not** keep a long-lived process per conversation — spawn **one short-lived process per turn**, resumed by id, and let it exit. This is stateless-friendly (fits a route handler / serverless-style model), avoids idle processes, and bounds blast radius. Apply your own wall-clock timeout on the child and `--require-mcp-startup` (exit code 3 on MCP failure) to fail fast. For concurrency, cap simultaneous spawns to protect the local machine and the credit budget.

Source: stderr credits/time line; resume test (this machine); `kiro-cli chat --help` (`--require-mcp-startup`); https://kiro.dev/docs/reference/exit-codes

## Summary

Drive the planner as `kiro-cli chat --no-interactive --agent larder-planner --trust-tools=@larder/… [--resume-id <id>] "<prompt>"` with `KIRO_API_KEY` in the env. Agent definition and its MCP servers live in `.kiro/agents/larder-planner.json` (`prompt: file://…`, `mcpServers: {…}`), not the dead `--agent-file`/`--mcp-config`. There is no JSON stream in 2.16.2, so the route handler strips ANSI from rendered stdout and re-emits it as SSE, using an in-band `PLAN_PROPOSAL_ID:` sentinel for structured signals; `--resume-id` (ids from `--list-sessions -f json`) gives verified multi-turn continuity, retiring v1's manual replay. Constrain the planner to MCP-only via the agent `tools` allow-list plus `--trust-tools`, spawn one process per turn, and budget ~0.1 credits/turn.

## Open questions

- Whether `--trust-tools=@larder` (server-wide) is accepted, or each tool must be listed as `@larder/<tool>` — the warning implies the `@{server}/` prefix but did not confirm server-wide wildcards; verify when the Larder MCP server exists.
- Exact API-key expiry/rotation semantics and behaviour of a call made with a revoked key (docs say keys don't have session expiry, but revocation handling was not exercised here).
