import { scValToNative, xdr } from "@stellar/stellar-sdk";

/** The subset of a Soroban RPC `getEvents` event we actually need. */
export interface RawEvent {
  contractId: string;
  topic: string[]; // base64 XDR ScVal strings
  value: string; // base64 XDR ScVal string
  ledger: number;
  ledgerClosedAt: string;
  txHash: string;
}

export type ParsedEvent =
  | {
      kind: "device_registered";
      device: string;
      deviceType: string;
      ledger: number;
      closedAt: string;
      txHash: string;
    }
  | {
      kind: "reading";
      device: string;
      regionCode: number;
      epoch: number;
      value: number;
      accepted: boolean;
      ledger: number;
      closedAt: string;
      txHash: string;
    }
  | {
      kind: "claimed";
      device: string;
      epoch: number;
      payout: bigint;
      ledger: number;
      closedAt: string;
      txHash: string;
    }
  | {
      kind: "subscribed";
      subscriber: string;
      periods: number;
      expiry: bigint;
      ledger: number;
      closedAt: string;
      txHash: string;
    };

function decode(base64: string): unknown {
  return scValToNative(xdr.ScVal.fromXDR(base64, "base64"));
}

/**
 * Decodes a raw contract event into one of DriftMesh's known event shapes,
 * or `null` if it isn't one we recognise (e.g. a diagnostic event, or an
 * event topic this indexer hasn't been taught about yet — logged by the
 * caller rather than silently dropped, see ingest/poller.ts).
 */
export function parseEvent(raw: RawEvent): ParsedEvent | null {
  if (raw.topic.length < 2) return null;

  const eventName = decode(raw.topic[0]);
  const subject = decode(raw.topic[1]);
  if (typeof eventName !== "string" || typeof subject !== "string") return null;

  const common = { ledger: raw.ledger, closedAt: raw.ledgerClosedAt, txHash: raw.txHash };

  switch (eventName) {
    case "reg_dev": {
      const deviceType = decode(raw.value);
      if (typeof deviceType !== "string") return null;
      return { kind: "device_registered", device: subject, deviceType, ...common };
    }
    case "reading": {
      const data = decode(raw.value) as unknown[];
      if (!Array.isArray(data) || data.length !== 4) return null;
      const [regionCode, epoch, value, accepted] = data;
      return {
        kind: "reading",
        device: subject,
        regionCode: Number(regionCode),
        epoch: Number(epoch),
        value: Number(value),
        accepted: Boolean(accepted),
        ...common,
      };
    }
    case "claimed": {
      const data = decode(raw.value) as unknown[];
      if (!Array.isArray(data) || data.length !== 2) return null;
      const [epoch, payout] = data;
      return {
        kind: "claimed",
        device: subject,
        epoch: Number(epoch),
        payout: BigInt(payout as bigint | number),
        ...common,
      };
    }
    case "subscribe": {
      const data = decode(raw.value) as unknown[];
      if (!Array.isArray(data) || data.length !== 2) return null;
      const [periods, expiry] = data;
      return {
        kind: "subscribed",
        subscriber: subject,
        periods: Number(periods),
        expiry: BigInt(expiry as bigint | number),
        ...common,
      };
    }
    default:
      return null;
  }
}
