# DriftMesh — Indexer

The backend: polls Stellar RPC for events from the four `contracts` repo
Soroban contracts, stores them in SQLite, and serves them over a small
REST API that `app` (the frontend) and any third-party data consumer
reads from.

```
Stellar RPC (getEvents) ──poll──▶ parser ──▶ SQLite ──▶ Express API
                                                              │
                                                     /devices, /devices/:a/readings,
                                                     /devices/:a/claims,
                                                     /regions/:code/average,
                                                     /subscriptions/:a
```

## Why this exists

The four contracts work on their own, but nobody can see what's
happening on-chain without reading raw event XDR by hand. This turns
that into a queryable API: "what's the current region average for
region 42", "has this device been paid for epoch 7", "is this
subscriber's access still active".

## Running it

```bash
npm install
cp .env.example .env   # fill in the contract IDs from `stellar contract deploy`
npm run dev             # tsx watch — polls RPC + serves the API
```

Without contract IDs set, the API still boots and serves an empty
dataset (useful for frontend development before contracts are deployed) —
it logs a warning rather than failing.

**Verified against a live deployment**, not just the in-process test
environment: all four contracts are deployed to Stellar testnet (IDs and
the exact flow exercised are in `contracts/TESTNET.md`), and this
indexer was run against them for real — readings and a claim submitted
on-chain were picked up within one poll cycle and correctly served back
out through the REST API (region average computed correctly from real
on-chain values, claim payout matched exactly).

```bash
npm test                # 25 tests: parser, repository, poller (RPC mocked), API
npm run typecheck
npm run build && npm start   # production build
```

## Known limitations

- **The `device_registered` event only carries `device_type`.** The
  contract's `register_device` event doesn't include `owner`/`lat`/`lon`
  (see `contracts/device-registry/src/lib.rs`), so the indexer can't
  populate those columns from events alone — they stay `null` until
  either the contract's event is enriched or the poller is extended to
  also call `get_device` for newly-seen devices. `devices.owner`/`lat`/
  `lon` are nullable for exactly this reason, not by oversight.
- **No deactivation events.** `device-registry.deactivate_device` doesn't
  emit an event, so a device deactivated on-chain will still show
  `active = 1` here until something polls `is_active` directly. A good
  first Wave issue, paired with adding the event on the contract side.
- **Cursor seeding, not backfill.** Stellar RPC only retains a short
  window of event history (currently ~7 days). The first time the poller
  sees a contract it has no stored cursor for, it starts from the
  *current* ledger, not from the contract's deployment ledger — it
  cannot backfill further back than RPC's retention window allows. A
  real backfill would require running Galexie or using a third-party
  indexer, same constraint the wider Stellar ecosystem is dealing with
  (see the `contracts` repo's research notes on the Horizon→RPC gap).
- **Single-process SQLite.** Fine for one indexer instance; swapping to
  Postgres for multi-instance/production use is a drop-in-shaped change
  (the repository layer is the only place that touches SQL) but hasn't
  been done.
- **Polling, not a subscription.** `pollOnce` runs on a fixed interval
  (`POLL_INTERVAL_MS`). Soroban RPC doesn't currently offer a push/
  websocket event stream, so polling is the standard approach — but the
  interval is a latency/RPC-load tradeoff worth tuning per deployment.

## Suggested Stellar Wave issues

**Trivial**
- Add a `GET /readings?region=&epoch=` endpoint listing raw readings (currently only per-device or aggregate-average views exist)
- Add request logging / basic error-handling middleware to `api/app.ts`

**Medium**
- Emit a `deactivated` event from `device-registry` and consume it here instead of leaving deactivation un-ingestable
- Add pagination to `GET /devices` and `GET /devices/:address/readings`

**High**
- Swap SQLite for Postgres behind the same repository interface, with a migration tool instead of the inline `CREATE TABLE IF NOT EXISTS` schema
- Replace fixed-interval polling with Soroban RPC's event streaming once/if it becomes available, or build a short-poll + backoff strategy that's kinder to RPC rate limits
