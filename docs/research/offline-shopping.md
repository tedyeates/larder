# Research: Ticking off a shopping list on supermarket signal

Date: 2026-08-11
Issue: [#35](https://github.com/tedyeates/larder/issues/35) (map #25)
Question: What can the Shop surface do on bad supermarket signal, for a Next.js App
Router app on Vercel's free tier with Supabase as the store? Ticking an item is a
**write** that banks stock into the pantry, so this is about offline *writes*, not
just offline reads.

## The physics of the problem, restated

A tick must do three things where signal is weakest (aisle three): (a) register
**instantly** in the UI, (b) **reliably** reach Supabase when signal returns, and
(c) **never double-bank** the pantry if the same tick is sent twice. The constraining
platform is iOS Safari — that is where the offline web APIs are thinnest, and it is
the phone most UK shoppers carry.

## 1. PWA on Next.js App Router today

- Next.js has **built-in** web-app-manifest support via `app/manifest.ts`
  (`MetadataRoute.Manifest`). Installability needs a valid manifest served over HTTPS;
  modern browsers then show an install prompt automatically.
  Source: https://nextjs.org/docs/app/guides/progressive-web-apps (last updated 2026-07-30, accessed 2026-08-11).
- **iOS has no `beforeinstallprompt`.** The official guide states custom install
  buttons via `beforeinstallprompt` are "not cross browser and platform (does not work
  on Safari iOS)" — the user must manually tap Share → "Add to Home Screen". Web Push
  works on iOS **only for apps installed to the home screen (iOS 16.4+)**.
  Source: same page (accessed 2026-08-11).
- **Service worker options:** hand-rolled (`lib/service-worker.js`) or **Serwist**.
  Next.js explicitly recommends Serwist "for full service-worker-based offline caching"
  and links Turbopack + webpack example repos. The framework itself does not bundle a
  caching service worker.
  Sources: https://nextjs.org/docs/app/guides/progressive-web-apps , https://github.com/serwist/serwist (accessed 2026-08-11).
- **`next-pwa` is deprecated — do not use.** The maintainer marked it "deprecated and
  is no longer maintained", and it is incompatible with the Next.js 16 Turbopack build
  (a webpack plugin), so people fall back to a manual `/public/sw.js`.
  Sources: https://github.com/shadowwalker/next-pwa/issues/241 , https://stackoverflow.com/questions/79896906/ (accessed 2026-08-11).
- Next.js also ships an **experimental `useOffline` hook** (+ `experimental.useOffline`
  config) for connectivity-aware UI and automatic retries of failed navigation and
  Server Action requests. Useful polish, not a queue.
  Source: https://nextjs.org/docs/app/api-reference/functions/use-offline (accessed 2026-08-11).
- **Vercel free (Hobby) tier:** the manifest and service worker are ordinary static
  assets served from Vercel's CDN — no special tier feature is required. Crucially, the
  offline design below sends writes **directly to Supabase** (not through a Vercel
  serverless function), so the queue does not depend on Vercel compute at all.
  Confidence: moderate (inferred from how SW/manifest are served; not verified against a
  dated Vercel pricing page this cycle).

## 2. Caching the list + optimistic local state

- **localStorage is unsuitable for the write queue**: it is synchronous and string-only.
  The durable outbox belongs in **IndexedDB** (async, structured, large quota).
  Source: https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API (accessed 2026-08-11).
- **Supabase has no turnkey offline story.** Offline is the single most-requested feature
  on their GitHub discussions; the client library does not queue writes.
  Source: https://powersync.com/blog/showcase-powersync-for-supabase-and-flutter (accessed 2026-08-11).
- Library landscape for Supabase offline:
  - **PowerSync** — full local SQLite mirror; the only Supabase sync engine with
    "first-class offline support". Batteries-included but heavyweight for one list.
  - **ElectricSQL** — "offline is out of scope by definition… developers must implement
    their own persistence."
  - **Zero** — "offline is out of scope for the time being."
  Source: https://powersync.com/blog/offline-first-apps-made-simple-supabase-powersync (2025, accessed 2026-08-11).
  - **TanStack Query** — persist the query cache + a mutation queue (`persistQueryClient`
    + offline mutation defaults) for optimistic writes that resume on reconnect. Next.js
    documents TanStack Query as a first-class client-fetch option.
    Source: https://nextjs.org/docs/app/guides/client-side-data-fetching/tanstack-query (accessed 2026-08-11).
- **Verdict:** a full sync engine is overkill for a shopping list. Cache the last-loaded
  list for offline *read* (service worker or a cached query), and hold ticks in a small
  IndexedDB outbox (hand-rolled, or via Dexie / TanStack Query mutation persistence).

## 3. Idempotent, replay-safe writes (Supabase RPC)

Concrete pattern that guarantees a doubly-sent tick never double-banks:

1. **Client mints an idempotency key** (a UUID `tick_id`) *at tick time* and stores it
   in the IndexedDB outbox alongside `{shopping_item_id, ts}`. The key is stable across
   retries.
2. On flush, call a Postgres function via **Supabase RPC**
   (`supabase.rpc('bank_tick', { p_tick_id, p_item_id })`). Supabase exposes any SQL
   function over the REST API for `rpc()`.
   Source: https://supabase.com/docs/guides/database/functions (accessed 2026-08-11).
3. The `plpgsql` function is one transaction:
   ```sql
   insert into tick_ledger(tick_id, shopping_item_id)
   values (p_tick_id, p_item_id)
   on conflict (tick_id) do nothing;      -- needs UNIQUE(tick_id)

   if found then                           -- row was new → apply stock delta once
     update pantry_stock ...;
   end if;
   ```
   `ON CONFLICT DO NOTHING` requires a unique constraint/index on the arbiter column and
   silently skips the insert on a duplicate; `found` is false on the replay, so the stock
   update is skipped. Insert + update commit atomically.
   Sources: https://www.postgresql.org/docs/current/sql-insert.html (ON CONFLICT),
   https://stackoverflow.com/questions/41513125/ (accessed 2026-08-11).
- **Result:** the client can retry blindly as many times as it likes; the ledger dedupes
  server-side. This is the simplest thing that is correct.

## 4. Conflict handling (queued tick meets an edit elsewhere)

- **Banking stock is additive/commutative**, so most edits don't truly conflict with a
  tick — order rarely matters.
- **Idempotency keys dedupe the *same* tick, not two *different* ticks of the same item.**
  Two devices ticking one item mint two `tick_id`s → two banks. To stop double-banking a
  *shopping item*, model "bought" as a per-item event: put the unique constraint on
  `shopping_item_id` (bank exactly once per item), or last-write-wins on the item's
  `checked` flag.
- **Item edited/removed before the tick flushes:** the function should tolerate a missing
  or soft-deleted item — record the tick and raise a **visible Inconsistency** (same
  pattern as recipe parsing in #34) rather than erroring or silently subtracting.
- True merge of concurrent quantity edits is out of scope for the simplest strategy.

## 5. Backgrounded / screen-locked, and the Background Sync API

- **Background Sync API is not usable on iOS.** MDN classes it "Limited availability…
  not Baseline because it does not work in some of the most widely-used browsers." It
  works in Chrome 49+, Edge 79+, Opera, Samsung Internet — **not Firefox, not Safari
  macOS, and not Safari iOS.**
  Sources: https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API (mod. 2024-04-22),
  https://www.lambdatest.com/web-technologies/background-sync-chrome , https://caniuse.com/background-sync (accessed 2026-08-11).
- **So the queue cannot flush while the app is backgrounded or the screen is locked** on
  an iPhone. What works cross-platform is flushing on the next app **foreground /
  `online` event / `visibilitychange`**.
- **This is fine for the use case:** the shopper is actively using the app, so a tick
  must be **capturable** offline (write to IndexedDB while the app is open) but does not
  need to **sync** in the background — it drains the moment they reopen the app with
  signal. Do **not** design around Background Sync.

## Summary — recommended simplest strategy

An **installable PWA + IndexedDB outbox + idempotent Supabase RPC**, flushed on
reconnect:

1. `app/manifest.ts` for installability (accept manual "Add to Home Screen" on iOS).
2. A minimal service worker (hand-rolled or Serwist) caching the app shell + last-loaded
   shopping list for offline **read**. Skip `next-pwa` (deprecated).
3. On tap: mint a `tick_id` (UUID), write the tick to an **IndexedDB** outbox, update the
   UI optimistically.
4. On `online`/foreground: drain the outbox by calling `rpc('bank_tick', …)`; the
   `plpgsql` function banks stock exactly once via `ON CONFLICT DO NOTHING` on the
   idempotency key. Retries are safe.
5. No Background Sync, no full sync engine (PowerSync/Electric), no CRDT.

**What this explicitly does NOT handle:**
- Syncing while the app is backgrounded or the screen is locked (no iOS Background Sync) —
  the queue flushes only when the app is reopened with signal.
- Concurrent multi-device edits of the same item beyond "bank once per item" /
  last-write-wins; no merge of simultaneous quantity edits.
- A list never loaded online (cold cache) — the shopper must have opened it at least once
  with signal.
- Guaranteed durability under storage pressure — IndexedDB can be evicted unless
  `navigator.storage.persist()` is granted.

## Open questions

- Vercel Hobby-tier limits should be confirmed against a dated pricing page, though the
  design deliberately routes writes to Supabase, not Vercel functions.
- Whether to batch outbox flushes into a single RPC (array arg) vs one RPC per tick —
  a performance choice, not a correctness one.
