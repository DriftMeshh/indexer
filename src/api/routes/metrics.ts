import { Router } from "express";
import type { Db } from "../../db/client.js";
import type { Config } from "../../config.js";
import type { PollerMetrics } from "../../ingest/poller.js";
import { latestLedger } from "../../stellar/rpc.js";
import * as repo from "../../db/repository.js";
import { logger, serializeError } from "../../logger.js";

/**
 * Metric label -> contract ID, in a stable order so repeated scrapes
 * produce a diffable, consistent line order. Empty if `config` wasn't
 * supplied to createApp at all (same "no config" case epochsRouter
 * handles) — the ledger-lag gauges are simply omitted in that case.
 */
function configuredContracts(config: Config | undefined): Array<[string, string]> {
  if (!config) return [];
  const candidates: Array<[string, string | undefined]> = [
    ["device_registry", config.contracts.deviceRegistry],
    ["submission_validator", config.contracts.submissionValidator],
    ["payment_streamer", config.contracts.paymentStreamer],
    ["subscription_market", config.contracts.subscriptionMarket],
  ];
  return candidates.filter((c): c is [string, string] => Boolean(c[1]));
}

/**
 * GET /metrics — Prometheus text exposition format (version 0.0.4).
 *
 * `getPollerMetrics` is a callback, not a value, because the poller
 * handle (and its metrics) may not exist yet when `createApp` is first
 * called, or may never exist at all if no contract IDs are configured
 * (see index.ts) — reading it lazily on each request avoids having to
 * wire the handle through before it's created.
 *
 * Ledger lag is a live read (chain tip minus this contract's stored
 * cursor) rather than something the poller tracks itself, so it reflects
 * reality even between poll cycles or while the poller is stopped.
 */
export function metricsRouter(
  db: Db,
  config: Config | undefined,
  getPollerMetrics?: () => PollerMetrics | undefined,
): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    const poller = getPollerMetrics?.();
    const lines: string[] = [];

    lines.push(
      "# HELP driftmesh_indexer_last_successful_poll_timestamp_seconds Unix timestamp of the last successful poll cycle.",
      "# TYPE driftmesh_indexer_last_successful_poll_timestamp_seconds gauge",
      `driftmesh_indexer_last_successful_poll_timestamp_seconds ${
        poller?.lastSuccessfulPollAt ? Math.floor(poller.lastSuccessfulPollAt / 1000) : 0
      }`,
    );
    lines.push(
      "# HELP driftmesh_indexer_consecutive_poll_failures Consecutive failed poll cycles.",
      "# TYPE driftmesh_indexer_consecutive_poll_failures gauge",
      `driftmesh_indexer_consecutive_poll_failures ${poller?.consecutiveFailures ?? 0}`,
    );
    lines.push(
      "# HELP driftmesh_indexer_last_cycle_events_ingested Events ingested in the most recently completed poll cycle.",
      "# TYPE driftmesh_indexer_last_cycle_events_ingested gauge",
      `driftmesh_indexer_last_cycle_events_ingested ${poller?.lastCycleEventsIngested ?? 0}`,
    );

    const contracts = configuredContracts(config);
    if (config && contracts.length > 0) {
      lines.push(
        "# HELP driftmesh_indexer_ledger_lag Ledgers between the chain tip and this contract's ingest cursor.",
        "# TYPE driftmesh_indexer_ledger_lag gauge",
      );
      try {
        const tip = await latestLedger(config.rpcUrl);
        for (const [label, contractId] of contracts) {
          const cursor = await repo.getCursor(db, contractId);
          // cursor === 0 means "never polled yet", not "0 ledgers behind" —
          // report a lag of 0 rather than a huge, meaningless tip-minus-0 number.
          const lag = cursor === 0 ? 0 : Math.max(tip - cursor, 0);
          lines.push(`driftmesh_indexer_ledger_lag{contract="${label}"} ${lag}`);
        }
      } catch (err) {
        logger.warn("metrics", "failed to compute ledger lag", serializeError(err));
      }
    }

    res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.send(lines.join("\n") + "\n");
  });

  return router;
}
