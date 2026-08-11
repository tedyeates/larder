---
inclusion: always
repo: tedyeates/larder
test_command: "pnpm test"
type_check_command: "pnpm check"
build_command: "pnpm build"
setup_command: "pnpm install"
host_setup_command: "pnpm dlx supabase start"
host_test_command: "pnpm dlx supabase test db"
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
Research: docs/research/

## Stack

Larder v2 (rewrite, branch `feature/remake-larder`). v1 is history on `feature/prd-1`; its code is
not reused.

Next.js App Router + React + TypeScript, Supabase Postgres for data and auth, **shadcn/ui** for
every component. Vitest for unit tests, pgTAP for the Postgres state transitions.

State transitions live in Postgres functions called via Supabase RPC, so both deploy targets share
one implementation. `host_test_command` runs the pgTAP suite, which needs a local Supabase, so it
runs on the host rather than inside a worktree.

**Two deploy targets, one codebase:** Vercel serves the loop surfaces (Today, Shop, Pantry) with the
planner disabled; a local desktop run sets `PLANNER_ENABLED=true` so the Plan page's route handler
can spawn `kiro-cli`. The planner sits behind a single seam and may only write drafts.

Map: #25.
