import { rpc as StellarRpc } from "@stellar/stellar-sdk";
import type { RawEvent } from "./parse.js";

export interface FetchEventsOptions {
  rpcUrl: string;
  contractIds: string[];
  startLedger: number;
  limit?: number;
}

export interface FetchEventsResult {
  events: RawEvent[];
  latestLedger: number;
}

/**
 * Pulls contract events for the given contracts starting at `startLedger`.
 * Stellar RPC only retains a short window of history (currently ~7 days) —
 * if `startLedger` is older than that, the RPC call will error and the
 * caller should fall back to the latest ledger rather than retry forever.
 * See the README's "Known limitations" section.
 */
export async function fetchEvents(options: FetchEventsOptions): Promise<FetchEventsResult> {
  const server = new StellarRpc.Server(options.rpcUrl);
  const response = await server.getEvents({
    startLedger: options.startLedger,
    filters: [
      {
        type: "contract",
        contractIds: options.contractIds,
      },
    ],
    limit: options.limit ?? 100,
  });

  const events: RawEvent[] = response.events.map((event) => ({
    contractId: event.contractId ? event.contractId.toString() : "",
    topic: event.topic.map((t) => t.toXDR("base64")),
    value: event.value.toXDR("base64"),
    ledger: event.ledger,
    ledgerClosedAt: event.ledgerClosedAt,
    txHash: event.txHash,
  }));

  return { events, latestLedger: response.latestLedger };
}

/** Current latest ledger sequence, used to seed a cursor for a never-before-seen contract. */
export async function latestLedger(rpcUrl: string): Promise<number> {
  const server = new StellarRpc.Server(rpcUrl);
  const health = await server.getLatestLedger();
  return health.sequence;
}
