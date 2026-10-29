# Contributing to DriftMesh — indexer

This repo is scoped for [Stellar Wave](https://www.drips.network/wave/stellar) —
issue complexity here follows Wave's own point system.

## Before you start

1. Read the [README](README.md) — in particular "Known limitations",
   which documents real, deliberate gaps (not oversights) so you don't
   spend a PR "fixing" something that's intentionally out of scope for
   now.
2. Set up and confirm the existing suite passes:

   ```bash
   npm install
   npm run build --workspaces --if-present   # builds bindings/device-registry
   npm test          # 27 tests should pass
   npm run typecheck
   ```

## Issue complexity (matches Stellar Wave's point system exactly)

| Tier | Points | What belongs here |
|---|---|---|
| Trivial | 100 | A new simple GET endpoint, request logging, a missing test for existing repository logic. |
| Medium | 150 | Pagination, a new enrichment step, retry/backoff logic for RPC calls. |
| High | 200 | Swapping SQLite for Postgres, replacing fixed-interval polling with a better strategy, anything touching the cursor/ingestion correctness guarantees. |

See the README's "Suggested Stellar Wave issues" section for concrete,
already-scoped examples at each tier.

## What a good PR looks like here

- **New `stellar/*.ts` calls get mocked in tests, not hit for real.**
  `rpc.ts` and `registry.ts` are deliberately separate, narrow modules
  specifically so `poller.test.ts` can mock them with `vi.mock` instead
  of needing a live network — see that file for the pattern. A PR that
  adds a new outbound call should follow the same shape.
- **Repository functions stay the only place that touches SQL.**
  `db/repository.ts` is the boundary; if your change needs a new query,
  add a function there rather than reaching into `db/client.ts`'s raw
  handle from elsewhere — this is what makes swapping SQLite for
  Postgres later a contained change instead of a rewrite.
- **A crash is a bug, not an edge case.** This is a long-running
  service — see the `unhandledRejection`/`uncaughtException` handlers in
  `index.ts` and their commit message for why that fix exists. If your
  change adds a new failure mode that could take the whole process down
  on a transient error, handle it the same way (log and continue, not
  throw and die).
- **PR description includes `Closes #<issue>`.**

## Known real gap worth knowing about before you start

The `device_registered` event only carries `device_type` — `owner`,
`lat`, `lon` are filled in by a *separate* best-effort read call in
`registry.ts`, not from the event itself. If you're touching anything
event-related, read that file's comments first; it's a deliberate
design choice forced by what the contract actually emits; see the
`contracts` repo if you want to change the event payload itself.
