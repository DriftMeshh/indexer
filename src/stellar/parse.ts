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
      kind: "device_deactivated";
      device: string;
      reason: string;
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
    }
  | {
      kind: "dispute_raised";
      device: string;
      disputer: string;
      evidenceHash: bigint;
      openDisputeCount: number;
      ledger: number;
      closedAt: string;
      txHash: string;
    }
  | {
      kind: "dispute_resolved";
      device: string;
      upheld: boolean;
      upheldTotal: number;
      deviceActive: boolean;
      ledger: number;
      closedAt: string;
      txHash: string;
    }
  | {
      kind: "auto_slash_threshold_reached";
      device: string;
      rejectedCount: number;
      threshold: number;
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
      // #[contractevent] encodes a struct's non-#[topic] fields as a
      // single SCV_MAP keyed by field name (scValToNative turns this into
      // a plain object) — not the bare value or positional tuple the
      // pre-migration env.events().publish() calls used.
      const data = decode(raw.value) as Record<string, unknown>;
      const deviceType = data?.device_type;
      if (typeof deviceType !== "string") return null;
      return { kind: "device_registered", device: subject, deviceType, ...common };
    }
    case "device_deactivated": {
      // Fixed from an earlier "deact_dev" guess that never matched the
      // real on-chain topic: device-registry's `DeviceDeactivated` struct
      // has no #[contractevent(topics = ...)] override, so the macro
      // derives its topic from the struct name via snake_case —
      // "device_deactivated", not "deact_dev". This meant deactivation
      // events were silently dropped (caught by the poller's unrecognised-
      // event warning, never by a thrown error) until this fix.
      const data = decode(raw.value) as Record<string, unknown>;
      const reason = data?.reason;
      if (typeof reason !== "string") return null;
      return { kind: "device_deactivated", device: subject, reason, ...common };
    }
    case "reading": {
      const data = decode(raw.value) as Record<string, unknown>;
      const { region_code: regionCode, epoch, value, accepted } = data ?? {};
      if (regionCode === undefined || epoch === undefined || value === undefined) return null;
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
      const data = decode(raw.value) as Record<string, unknown>;
      const { epoch, payout } = data ?? {};
      if (epoch === undefined || payout === undefined) return null;
      return {
        kind: "claimed",
        device: subject,
        epoch: Number(epoch),
        payout: BigInt(payout as bigint | number),
        ...common,
      };
    }
    case "subscribe": {
      const data = decode(raw.value) as Record<string, unknown>;
      const { periods, new_expiry: expiry } = data ?? {};
      if (periods === undefined || expiry === undefined) return null;
      return {
        kind: "subscribed",
        subscriber: subject,
        periods: Number(periods),
        expiry: BigInt(expiry as bigint | number),
        ...common,
      };
    }
    case "dispute_raised": {
      const data = decode(raw.value) as Record<string, unknown>;
      const { disputer, evidence_hash: evidenceHash, open_dispute_count: openDisputeCount } =
        data ?? {};
      if (
        typeof disputer !== "string" ||
        evidenceHash === undefined ||
        openDisputeCount === undefined
      ) {
        return null;
      }
      return {
        kind: "dispute_raised",
        device: subject,
        disputer,
        evidenceHash: BigInt(evidenceHash as bigint | number),
        openDisputeCount: Number(openDisputeCount),
        ...common,
      };
    }
    case "dispute_resolved": {
      const data = decode(raw.value) as Record<string, unknown>;
      const { upheld, upheld_total: upheldTotal, device_active: deviceActive } = data ?? {};
      if (upheld === undefined || upheldTotal === undefined || deviceActive === undefined) {
        return null;
      }
      return {
        kind: "dispute_resolved",
        device: subject,
        upheld: Boolean(upheld),
        upheldTotal: Number(upheldTotal),
        deviceActive: Boolean(deviceActive),
        ...common,
      };
    }
    case "auto_slash_threshold_reached": {
      const data = decode(raw.value) as Record<string, unknown>;
      const { rejected_count: rejectedCount, threshold } = data ?? {};
      if (rejectedCount === undefined || threshold === undefined) return null;
      return {
        kind: "auto_slash_threshold_reached",
        device: subject,
        rejectedCount: Number(rejectedCount),
        threshold: Number(threshold),
        ...common,
      };
    }
    default:
      return null;
  }
}
