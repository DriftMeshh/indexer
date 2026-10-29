import type { Db } from "../db/client.js";
import * as repo from "../db/repository.js";
import { fetchEvents, latestLedger } from "../stellar/rpc.js";
import { fetchDeviceRecord } from "../stellar/registry.js";
import { parseEvent, type ParsedEvent } from "../stellar/parse.js";
import type { Config } from "../config.js";

export interface PollerDeps {
  db: Db;
  config: Config;
}

/** Polls every configured contract once, ingesting any new events into the DB. */
export async function pollOnce({ db, config }: PollerDeps): Promise<void> {
  const contractIds = [
    config.contracts.deviceRegistry,
    config.contracts.submissionValidator,
    config.contracts.paymentStreamer,
    config.contracts.subscriptionMarket,
  ].filter((id): id is string => Boolean(id));

  for (const contractId of contractIds) {
    await pollContract(db, config, contractId);
  }
}

async function pollContract(db: Db, config: Config, contractId: string): Promise<void> {
  let startLedger = repo.getCursor(db, contractId);
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

  for (const raw of events) {
    const parsed = parseEvent(raw);
    if (!parsed) {
      console.warn(`[poller] unrecognised event on ${contractId}, topic[0]=${raw.topic[0]}`);
      continue;
    }
    await applyEvent(db, config, parsed);
  }

  repo.setCursor(db, contractId, Math.max(newLatest, startLedger));
}

async function applyEvent(db: Db, config: Config, event: ParsedEvent): Promise<void> {
  switch (event.kind) {
    case "device_registered": {
      repo.upsertDevice(db, {
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
          repo.upsertDevice(db, {
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
    case "reading":
      repo.insertReading(db, {
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
      repo.insertClaim(db, {
        device_address: event.device,
        epoch: event.epoch,
        payout: event.payout.toString(),
        ledger: event.ledger,
        closed_at: event.closedAt,
        tx_hash: event.txHash,
      });
      break;
    case "subscribed":
      repo.upsertSubscription(db, {
        subscriber: event.subscriber,
        periods_last_purchase: event.periods,
        expiry: Number(event.expiry),
        updated_at_ledger: event.ledger,
      });
      break;
  }
}

/**
 * Runs `pollOnce` forever on `intervalMs`. Errors are logged, not thrown,
 * so one bad RPC call (e.g. a transient network blip) doesn't kill the
 * process. Returns a function that stops the loop.
 */
export function startPolling(deps: PollerDeps, intervalMs: number): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const tick = async () => {
    if (stopped) return;
    try {
      await pollOnce(deps);
    } catch (err) {
      console.error("[poller] tick failed:", err);
    }
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };

  tick();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
