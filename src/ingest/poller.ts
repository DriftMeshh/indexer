import type { Db } from "../db/client.js";
import * as repo from "../db/repository.js";
import { fetchEvents, latestLedger } from "../stellar/rpc.js";
import { fetchDeviceRecord } from "../stellar/registry.js";
import { parseEvent, type ParsedEvent } from "../stellar/parse.js";
import type { Config } from "../config.js";
import { logger, serializeError } from "../logger.js";

export interface PollerDeps {
  db: Db;
  config: Config;
}

/**
 * Polls every configured contract once, ingesting any new events into the
 * DB. Returns how many events were actually applied this cycle (i.e.
 * recognised by parseEvent and successfully written) — used by
 * startPolling to track the `lastCycleEventsIngested` metric exposed at
 * GET /metrics.
 */
export async function pollOnce({ db, config }: PollerDeps): Promise<number> {
  const contractIds = [
    config.contracts.deviceRegistry,
    config.contracts.submissionValidator,
    config.contracts.paymentStreamer,
    config.contracts.subscriptionMarket,
  ].filter((id): id is string => Boolean(id));

  let eventsIngested = 0;
  for (const contractId of contractIds) {
    eventsIngested += await pollContract(db, config, contractId);
  }
  return eventsIngested;
}

async function pollContract(db: Db, config: Config, contractId: string): Promise<number> {
  let startLedger = await repo.getCursor(db, contractId);
  if (startLedger === 0) {
    // First time seeing this contract — start from the current ledger
    // rather than trying to backfill from genesis. RPC only retains a
    // short history window (currently ~7 days) so a true backfill past
    // that point isn't possible without a third-party indexer anyway.
    startLedger = await latestLedger(config.rpcUrl);
  }

  const { events, latestLedger: newLatest } = await fetchEvents({
    rpcUrl: config.rpcUrl,
    contractIds: [contractId],
    startLedger,
  });

  let ingested = 0;
  for (const raw of events) {
    const parsed = parseEvent(raw);
    if (!parsed) {
      logger.warn("poller", "unrecognised event", { contractId, topic0: raw.topic[0] });
      continue;
    }
    await applyEvent(db, config, parsed);
    ingested += 1;
  }

  await repo.setCursor(db, contractId, Math.max(newLatest, startLedger));
  return ingested;
}

async function applyEvent(db: Db, config: Config, event: ParsedEvent): Promise<void> {
  switch (event.kind) {
    case "device_registered": {
      await repo.upsertDevice(db, {
        address: event.device,
        owner: null,
        device_type: event.deviceType,
        lat: null,
        lon: null,
        registered_at: Math.floor(new Date(event.closedAt).getTime() / 1000),
      });

      // The event alone doesn't carry owner/lat/lon (see parse.ts) — fill
      // them in with a direct read, best-effort. A failed enrichment
      // leaves the row as-is (nullable columns, see db/client.ts) rather
      // than failing the whole poll.
      if (config.contracts.deviceRegistry) {
        const record = await fetchDeviceRecord(
          config.rpcUrl,
          config.networkPassphrase,
          config.contracts.deviceRegistry,
          event.device,
        );
        if (record) {
          await repo.upsertDevice(db, {
            address: event.device,
            owner: record.owner,
            device_type: record.deviceType,
            lat: record.lat,
            lon: record.lon,
            registered_at: Math.floor(new Date(event.closedAt).getTime() / 1000),
            active: record.active ? 1 : 0,
          });
        }
      }
      break;
    }
    case "device_deactivated":
      // The contract flips active -> false on deactivation; mirror that
      // here so a deactivated device stops showing active = 1 immediately,
      // without anything having to poll is_active directly.
      await repo.setDeviceActive(db, event.device, false);
      break;
    case "reading":
      await repo.insertReading(db, {
        device_address: event.device,
        device_type: null,
        region_code: event.regionCode,
        epoch: event.epoch,
        value: event.value,
        accepted: event.accepted ? 1 : 0,
        ledger: event.ledger,
        closed_at: event.closedAt,
        tx_hash: event.txHash,
      });
      break;
    case "claimed":
      await repo.insertClaim(db, {
        device_address: event.device,
        epoch: event.epoch,
        payout: event.payout.toString(),
        ledger: event.ledger,
        closed_at: event.closedAt,
        tx_hash: event.txHash,
      });
      break;
    case "subscribed":
      await repo.upsertSubscription(db, {
        subscriber: event.subscriber,
        periods_last_purchase: event.periods,
        expiry: Number(event.expiry),
        updated_at_ledger: event.ledger,
      });
      break;
    case "dispute_raised":
      await repo.insertDispute(db, {
        device_address: event.device,
        disputer: event.disputer,
        evidence_hash: event.evidenceHash.toString(),
        raised_ledger: event.ledger,
        raised_closed_at: event.closedAt,
        raised_tx_hash: event.txHash,
      });
      break;
    case "dispute_resolved": {
      const resolved = await repo.resolveDispute(db, {
        device_address: event.device,
        upheld: event.upheld,
        resolved_ledger: event.ledger,
        resolved_closed_at: event.closedAt,
        resolved_tx_hash: event.txHash,
      });
      if (!resolved) {
        // Not a failure — e.g. the dispute was raised before this indexer
        // started watching the contract (cursor seeding, not backfill;
        // see README) — but worth knowing about if it happens a lot.
        logger.warn("poller", "dispute_resolved with no matching open dispute", {
          device: event.device,
        });
      }
      // The contract's own event already tells us the resulting active
      // state directly (device_active) — no need for a second read.
      await repo.setDeviceActive(db, event.device, event.deviceActive);
      break;
    }
    case "auto_slash_threshold_reached":
      await repo.insertAutoSlashEvent(db, {
        device_address: event.device,
        rejected_count: event.rejectedCount,
        threshold: event.threshold,
        ledger: event.ledger,
        closed_at: event.closedAt,
        tx_hash: event.txHash,
      });
      break;
  }
}

export interface PollerMetrics {
  /** Unix ms timestamp of the last poll cycle that completed without throwing, or null if none has yet. */
  lastSuccessfulPollAt: number | null;
  /** Resets to 0 on any successful cycle; counts how many cycles in a row have thrown. */
  consecutiveFailures: number;
  /** Events applied in the most recently *completed* cycle (success or failure). */
  lastCycleEventsIngested: number;
}

export interface PollerHandle {
  /** Stops scheduling further poll cycles. Does not interrupt one already in flight. */
  stop(): void;
  /**
   * Resolves once the currently in-flight poll cycle (if any) finishes.
   * Call `stop()` first, then await this, before tearing down shared
   * resources like the DB connection — see `index.ts`'s SIGTERM handler.
   */
  whenIdle(): Promise<void>;
  /** A snapshot of current poller health — see GET /metrics. */
  metrics(): PollerMetrics;
}

/**
 * Runs `pollOnce` forever on `intervalMs`. Errors are logged, not thrown,
 * so one bad RPC call (e.g. a transient network blip) doesn't kill the
 * process. Returns a handle to stop the loop and wait for it to go idle.
 */
export function startPolling(deps: PollerDeps, intervalMs: number): PollerHandle {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let currentTick: Promise<void> = Promise.resolve();
  const metrics: PollerMetrics = {
    lastSuccessfulPollAt: null,
    consecutiveFailures: 0,
    lastCycleEventsIngested: 0,
  };

  const tick = async () => {
    if (stopped) return;
    currentTick = (async () => {
      try {
        metrics.lastCycleEventsIngested = await pollOnce(deps);
        metrics.lastSuccessfulPollAt = Date.now();
        metrics.consecutiveFailures = 0;
      } catch (err) {
        metrics.consecutiveFailures += 1;
        logger.error("poller", "tick failed", serializeError(err));
      }
    })();
    await currentTick;
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };

  tick();
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
    whenIdle() {
      return currentTick;
    },
    metrics() {
      // A fresh object each call — callers get a point-in-time snapshot,
      // not a live reference they could (even accidentally) mutate.
      return { ...metrics };
    },
  };
}
