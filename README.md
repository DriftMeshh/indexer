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
                                                     /readings?region=&epoch=,
                                                     /subscriptions/:a
```

## Pagination

`GET /devices` and `GET /devices/:address/readings` support `limit`/`offset`
query parameters:

| Param    | Default | Max | Notes                                         |
|----------|---------|-----|-----------------------------------------------|
| `limit`  | 50      | 500 | Clamped to 500 if higher value supplied       |
| `offset` | 0       | —   | 400 if negative or non-numeric                |

Responses are wrapped in a JSON envelope:

```json
{
  "data":   [ /* array of DeviceRow / ReadingRow */ ],
  "total":  1234,
  "limit":  50,
  "offset": 0
}
```

- `total` is the full count of matching rows **before** LIMIT/OFFSET, so
  clients can calculate the number of pages without a separate request.
- `limit` in the response reflects the **effective** limit (may be lower
  than the requested value if it was clamped to 500).
- Both endpoints return HTTP **200** with an empty `data` array when
  `offset` exceeds `total` — this is intentional so clients can safely
  paginate to the end of a list.

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
npm test                # 38 tests: parser, repository, poller (RPC mocked), API
npm run typecheck
npm run build && npm start   # production build
```

## Deploying

Four hosting options are set up below. Free-tier card/signup policies
on these platforms change often and even contradict their own docs in
practice — each option here was checked live, not assumed from
memory, as of November 2026; re-verify before relying on any of them.

### Bot-Hosting.net (currently the reliable no-card, permanent-URL option)

Despite the name, [Bot-Hosting.net](https://bot-hosting.net) hosts plain
Node.js APIs and workers, not just Discord bots — verified live: account
creation needs no card anywhere in the flow (GitHub OAuth sign-in only).
Free plan: 256MB RAM, 25% CPU, 512MB storage, **one deployment**,
no spin-down — but the free plan does need manual renewal from its
dashboard every 4 days to keep the resources allocated (a reminder shows
up before it lapses); Starter+ at $2.09/mo removes both that and the
one-deployment cap. **This repo's `Dockerfile` is not actually used** —
despite Node.js deployments showing a "pre-installed in Docker image"
message, it pulls its own generic `ghcr.io/parkervcp/yolks:nodejs_22`
runtime regardless, confirmed from the live deploy log; the Dockerfile
is kept for other Docker-based hosts (e.g. Back4App below) and for
local verification. Two things to set manually in the deployment's
**Settings → Startup** tab, since its defaults don't fit a TypeScript
project: the entry file (`dist/index.js`, not its default `index.js`),
and the start command, overridden to add a build step before starting —
`cd /home/container && if [ -f package.json ]; then npm install
--no-fund --no-audit && npm run build; fi && exec node ${STARTUP_FILE}`.
One thing specific to this host: it injects the app's port as
`SERVER_PORT`, not the more common `PORT` — `config.ts` reads `env.PORT
?? env.SERVER_PORT` so it works on either. Add the same env vars
`render.yaml` lists below under the deployment's **Environment** tab,
then **Start** it.

**device-sdk runs here too**, bundled into this same deployment rather
than a separate one, since the free plan's cap is one deployment per
account — see [`device-sdk`'s README](https://github.com/DriftMeshh/device-sdk#deploying)
for the exact Start command that launches both. This is what keeps the
live demo showing moving data instead of a static snapshot.

### Back4App Containers (reliable no-card option, but temporary URL on the free plan)

`Dockerfile` builds this service for [Back4App Containers](https://back4app.com/pricing/container-as-a-service)
(or any other Docker-based host) — verified locally end-to-end: `docker
build` succeeds, and the resulting image starts, binds to `PORT`,
gracefully continues without a `.env` file, and serves real `/health`
and `/devices` responses. Back4App's free tier is explicitly "no credit
card required" in their own FAQ (0.25 CPU / 256MB RAM / 100GB transfer,
deploy from GitHub, no spin-down). After connecting the repo, add the
same env vars `render.yaml` lists below as the container's environment
variables in Back4App's dashboard. **Caveat found only at actual deploy
time, not in their docs:** the free plan's URL is temporary, expiring 60
minutes after each deploy — only their paid Starter plan ($5/mo) gets a
permanent URL, which is why Bot-Hosting.net above is listed first.

### Railway (no card required, but new signups are currently paused)

`railway.json` configures the build/start/health-check for [Railway](https://railway.com):
connect this repo (Railway auto-detects Node via Nixpacks; `engines.node`
in `package.json` pins it to 22, avoiding the `better-sqlite3`
prebuilt-binary ABI mismatch noted in `.github/workflows/ci.yml`), then
add the same env vars `render.yaml` lists below (Railway's config-as-code
doesn't set variable values itself, so this is a one-time manual step in
its dashboard). Railway's free trial needs **no credit card to deploy**
(confirmed directly on [Railway's pricing page](https://railway.com/pricing)):
$5 of usage credit over a 30-day trial, which a service this light
(0.5GB RAM) should comfortably stay within, and unlike Render's free
tier a Railway service doesn't spin down from inbound-traffic idleness.
**As of early November 2026, Railway has new signups paused platform-wide**
following an October 21 incident (see [status.railway.com](https://status.railway.com)) —
check there before trying this option; it may be an existing-account-only
option until that's resolved.

### Render (alternative — some accounts are asked to verify a card)

`render.yaml` is a ready-to-use [Render](https://render.com) blueprint
— connect this repo on Render and it deploys as a free web service
with the already-deployed testnet contract IDs pre-filled (they're
public on-chain identifiers, not secrets). `GET /health` is wired up
as the health check. Render injects its own `PORT`; `config.ts`
already reads `env.PORT`, so no change is needed there. Render's own
docs describe the free tier as not requiring a card, but some accounts
are shown a card-verification step (a $1 temporary authorization, not a
charge) during onboarding regardless — if that happens, Railway above
is the no-card fallback.

**One real caveat with the free plan — and it's more frequent than it
sounds**: per [Render's own docs](https://render.com/docs/free), a
free web service spins down after just 15 minutes with no inbound
traffic, and its filesystem resets on every spin-down, not only on a
redeploy. So `DB_PATH`'s SQLite file — and with it, the poller's
stored cursor — is lost any time the service has been idle for 15+
minutes, which for a lightly-visited demo could be most of the time.
Combined with the "cursor seeding, not backfill" limitation below,
that means a freshly spun-up instance starts from the *current*
ledger, not from where it left off, so `GET /devices` will come back
empty until new on-chain activity happens after that spin-up. For a
demo, the simplest fix is running `device-sdk`'s `npm run simulate`
shortly before anyone looks at the live site — or use Render's paid
Starter plan (no spin-down) with a persistent disk if you need state
to survive both spin-downs and redeploys.

## Known limitations

- **The `device_registered` event only carries `device_type`.** The
  contract's `register_device` event doesn't include `owner`/`lat`/`lon`
  (see `contracts/device-registry/src/lib.rs`), so the indexer can't
  populate those columns from events alone — they stay `null` until
  either the contract's event is enriched or the poller is extended to
  also call `get_device` for newly-seen devices. `devices.owner`/`lat`/
  `lon` are nullable for exactly this reason, not by oversight.
- **Deactivation events: indexer ready, contract side pending.** The
  indexer now parses `device-registry`'s `deact_dev` event and flips
  `devices.active` to 0 (`parse.ts` → `poller.ts` → `setDeviceActive`),
  but `deactivate_device` on the contract side does not yet emit that
  event — so until the companion contract change (adding a `DeactDev`
  `#[contractevent]` whose topics are `["deact_dev", device_address]`)
  lands, a device deactivated on-chain still shows `active = 1` here.
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
- **`GET /readings` has no pagination.** Returns all readings for a
  region+epoch in one response. For a high-volume deployment this could
  become large; adding a `limit`/`offset` query param would follow the
  same pattern as `GET /devices/:address/readings`.
- **Polling, not a subscription.** `pollOnce` runs on a fixed interval
  (`POLL_INTERVAL_MS`). Soroban RPC doesn't currently offer a push/
  websocket event stream, so polling is the standard approach — but the
  interval is a latency/RPC-load tradeoff worth tuning per deployment.

## Suggested Stellar Wave issues

**Medium**
- Emit a `deactivated` event from `device-registry` and consume it here instead of leaving deactivation un-ingestable
- Add pagination to `GET /devices` and `GET /devices/:address/readings`

**High**
- Swap SQLite for Postgres behind the same repository interface, with a migration tool instead of the inline `CREATE TABLE IF NOT EXISTS` schema
- Replace fixed-interval polling with Soroban RPC's event streaming once/if it becomes available, or build a short-poll + backoff strategy that's kinder to RPC rate limits
