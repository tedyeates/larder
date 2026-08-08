---
inclusion: always
repo: tedyeates/larder
test_command: "pnpm test"
type_check_command: "pnpm check"
build_command: "pnpm build"
setup_command: "pnpm install"
host_setup_command: "npx supabase start"
host_test_command: "npx supabase test db"
concurrency: 3
---
# Project Configuration

## Issue Tracker

Type: github
Repo: tedyeates/larder
CLI: gh
Write access: verified

## Triage Labels

| Role | Label |
|------|-------|
| needs-triage | needs-triage |
| needs-info | needs-info |
| ready-for-agent | ready-for-agent |
| ready-for-human | ready-for-human |

## Wayfinder Labels

| Type | Label |
|------|-------|
| map | wayfinder:map |
| research | wayfinder:research |
| prototype | wayfinder:prototype |
| grilling | wayfinder:grilling |
| task | wayfinder:task |

## Domain Docs

Layout: single-context
Glossary: CONTEXT.md
ADRs: docs/adr/ (NNNN-title.md)

## Stack

Next.js App Router + React + TypeScript on Vercel, Supabase Postgres for data and auth.
Vitest for unit tests, pgTAP for the Postgres state transitions.

State transitions live in Postgres functions called via Supabase RPC — the UI and the MCP share one
implementation. `host_test_command` runs the pgTAP suite, which needs a local Supabase, so it runs
on the host rather than inside a worktree.

Planning AI runs in a separate Agent Runner container, reached over a configurable URL. See
`docs/adr/0002-ai-optional-agent-runner.md`.
