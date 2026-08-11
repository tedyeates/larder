# Research: Free / near-free tool-calling APIs behind the planner seam

Date: 2026-08-11
Issue: [#33](https://github.com/tedyeates/larder/issues/33) (map [#25](https://github.com/tedyeates/larder/issues/25))
Question: Which free or cheap hosted LLM APIs could sit behind the planner seam later, so
meal planning works from a phone (Vercel-hosted)? Which is good enough for a multi-turn,
tool-calling planning conversation that must hold strict arithmetic (servings × multiplier =
assigned slots)?

> All figures are dated. Rate limits and policies are time-sensitive — re-verify before any swap.
> `kiro-cli` local stays the decision for now; this only charts the hosted option.

## The workload it must serve

A multi-turn conversation that (a) calls tools across several steps — read pantry, read recipes,
read meal history, write a draft plan — and (b) holds strict arithmetic across those turns. That
means the model must **survive multi-step tool loops** (tool call → tool result → next tool call)
and be reliable at integer arithmetic, not just expose a `tools` parameter.

## Comparison

| Provider | Genuinely free tier? | Free rate limits (dated) | Tool/function calling | Multi-step tool loop | Streaming | Context window | Personal non-commercial OK? | Trains on free-tier input? |
|---|---|---|---|---|---|---|---|---|
| **Google Gemini** (AI Studio API) | **Yes** — perpetual free tier | Per-model RPM/TPM/RPD, viewable only in AI Studio; RPD resets midnight PT. Free tier has no spend cap. (2026-07-21) | Yes — native function calling | Yes — supports parallel + sequential/compositional calling | Yes | Up to 1M on select models (1M free-tier access is limited/varies) | Yes (ToS permits) | **YES — free-tier prompts/responses ARE used to improve Google products.** Only paid tier opts you out. (2026-08-10) |
| **Groq** (GroqCloud) | **Yes** — free tier, no credit card | ~30 RPM on free tier; per-model RPM/RPD/TPM/TPD in console (larger models ~1,000 RPD, secondary sources 2026-03) | Yes — OpenAI-compatible tool use | Yes | Yes | Model-dependent (e.g. 128K+ on Llama-class) | Yes | **No — does not train on Inputs/Outputs; default ≤30-day log retention; self-serve Zero Data Retention opt-out.** (2026 privacy/your-data docs) |
| **OpenRouter** (`:free` models) | **Yes** — permanent free variants | 20 RPM; **50 requests/day**, rising to **1,000/day** after a one-time $10 credit purchase; limits are account-wide, not per-model (2026-01 / 2026-04) | Yes — tool calling supported (varies by underlying model) | Yes, model-dependent | Yes | Depends on routed model | Yes | **Depends on routed provider.** Account setting to disallow training providers; separate toggle for free vs paid. `:free` may route to providers that train unless you opt out. (undated policy page, read 2026-08-11) |
| **Cerebras** (Inference) | **No perpetual free tier** | Free *Trial* only: **$5 credits, expire 30 days**. Trial per-model caps: **5 RPM / 30K TPM / 1M TPD** (gpt-oss-120b, GLM-4.7, gemma-4-31b). Free-tier req ≤65K in / 32K out. (docs updated ~2026-08) | Yes — tool use | Yes, but **5 RPM will 429 a parallel-tool agent fast** | Yes | 65K input on free trial (131K paid) | Yes | Not documented as training; treat as trial-only | 
| **AWS Bedrock** | **No Bedrock-specific free allowance** | Pay-per-token (Standard/Flex/Priority/Reserved tiers). New AWS "Free account plan" = credits for up to 6 months for POCs, not an always-free model quota. (pricing page 2026) | Yes — Converse API tool use (unified across models) | Yes | Yes (ConverseStream) | Model-dependent | Yes | **No — ZDR + zero-operator-access by default; inputs/outputs not stored, not used to train, not shared with model providers.** (Bedrock docs) |

## Key privacy finding (the decisive axis)

The planner sees the user's **private pantry and preferences**. On that axis the providers split hard:

- **Trains on your free input:** **Gemini free tier** — the billing docs state that moving to a
  paid tier is how you "ensure your prompts and responses are **not** used to improve Google
  products," which means the free tier's inputs **are** used. Disqualifying for private data unless
  billing is enabled.
  Source: https://ai.google.dev/gemini-api/docs/billing (2026-08-10)
- **Conditional:** **OpenRouter `:free`** — some upstream providers train; you must set the
  account-wide "do not route to training providers" toggle (separate free/paid settings).
  Source: https://openrouter.ai/docs/features/privacy-and-logging (read 2026-08-11)
- **Does not train:** **Groq** (default no-retention-beyond-logs, ZDR opt-out) and **Bedrock**
  (ZDR + zero-operator-access by default).
  Sources: https://console.groq.com/docs/your-data ; https://docs.aws.amazon.com/bedrock/latest/userguide/abuse-detection.html

## Notes on fit

- **Cerebras is out** as a *free* option: it has no perpetual free tier (only $5 / 30-day trial),
  and the trial's **5 RPM** cap would 429 almost immediately under a multi-step tool loop.
  Source: https://inference-docs.cerebras.ai/support/rate-limits
- **Bedrock is out** as a *free* option: no free model quota; it is pay-per-use. Best privacy, but
  costs money and adds AWS-credential/SigV4 plumbing on Vercel.
- **Gemini** has the most generous perpetual free tier and strongest tool calling, but **trains on
  free-tier input** — unacceptable for a private pantry unless billing is turned on (which stops
  being "free").
- **OpenRouter** free tier is real but request-starved (50/day, or 1,000/day after a $10 top-up),
  and privacy depends on picking/opting-into non-training providers.
- **Groq** is the best free-and-private combination: no credit card, genuine free tier, ~30 RPM
  (enough headroom for a bursty multi-step tool loop for one household user), OpenAI-compatible
  tool calling and streaming, and it does **not** train on inputs (with a ZDR opt-out on top).

## Recommendation — first provider to try if the swap happens

**Groq.** It is the only candidate that is simultaneously (1) genuinely free with no card, (2)
does not train on the user's private input, and (3) has tool calling + streaming and enough RPM
headroom to survive a multi-step planning loop for a single-household workload. Behind the seam,
use an OpenAI-compatible client so **OpenRouter** (with the "no training providers" toggle set) is
a drop-in fallback if a Groq model regresses on the strict-arithmetic requirement, and keep
**Bedrock** as the paid, best-privacy escalation if this ever needs commercial-grade guarantees.

Validate before committing: run the real planning loop (pantry/recipes/history reads + draft
write) and assert **servings × multiplier == assigned slots** across a handful of Groq models —
arithmetic reliability under a long tool loop is the make-or-break test, and only a live eval
settles it.

## Open questions

- Groq's exact **per-model free-tier RPD** is only visible in the logged-in console; the ~1,000/day
  figure for larger models comes from dated secondary sources, not Groq's page. Confirm in-console.
- Gemini free-tier numeric RPM/RPD are shown only in AI Studio (not the public docs table) — read
  them there before relying on any specific figure.
- Which specific free model on Groq/OpenRouter holds the strict arithmetic best is unresolved
  without a live eval against the planner's own tool set.

## Citations

- Gemini rate limits — https://ai.google.dev/gemini-api/docs/rate-limits (updated 2026-07-21)
- Gemini billing / free-tier training statement — https://ai.google.dev/gemini-api/docs/billing (updated 2026-08-10)
- Gemini function calling — https://ai.google.dev/gemini-api/docs/function-calling
- Groq rate limits — https://console.groq.com/docs/rate-limits
- Groq data handling ("Your Data in GroqCloud", ≤30-day logs, ZDR opt-out) — https://console.groq.com/docs/your-data
- Groq free tier ~30 RPM, no card (secondary, 2026) — https://www.eesel.ai/blog/groq-pricing ; https://pricepertoken.com/endpoints/groq/free
- OpenRouter free-model limits (20 RPM; 50/day → 1,000/day after $10) — https://openrouter.ai/docs/api_reference/limits ; https://markaicode.com/errors/openrouter-rate-limits-fix/ (2026)
- OpenRouter provider logging / training toggle — https://openrouter.ai/docs/features/privacy-and-logging (read 2026-08-11)
- Cerebras rate limits + "no permanently free tier" FAQ + $5/30-day trial — https://inference-docs.cerebras.ai/support/rate-limits (updated ~2026-08)
- Cerebras tool use — https://inference-docs.cerebras.ai/capabilities/tool-use
- Bedrock pricing / tiers — https://aws.amazon.com/bedrock/pricing/ (2026)
- Bedrock ZDR / zero-operator-access / no-training — https://docs.aws.amazon.com/bedrock/latest/userguide/abuse-detection.html ; https://www.repost.aws/knowledge-center/amazon-bedrock-model-data-use
- Bedrock Converse API tool use + no-storage — https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html
- AWS Free account plan (credits, up to 6 months) — https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier.html
