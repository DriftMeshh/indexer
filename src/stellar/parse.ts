import { scValToNative, xdr } from "@stellar/stellar-sdk";
import { logger } from "../logger.js";

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

const isString = (v: unknown): v is string => typeof v === "string";
const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";
/** u32/u64/i128 etc. decode via scValToNative as either number or bigint. */
const isNumberLike = (v: unknown): v is number | bigint =>
  typeof v === "number" || typeof v === "bigint";

type FieldCheckers = Record<string, (v: unknown) => boolean>;

/**
 * Checks a decoded event's data object against the fields a known event
 * name is expected to carry, returning the names of any that are missing
 * or the wrong type. This is the shape-validation this parser didn't have
 * until this session's biggest bug: the `#[contractevent]` macro's switch
 * to map-shaped values broke every case here silently, with nothing more
 * specific than the poller's generic "unrecognised event" warning (which
 * doesn't fire at all for a KNOWN event name whose payload just doesn't
 * match — those cases returned null with no signal whatsoever). A future
 * contract-side encoding change should be loud, not silent.
 */
function missingOrInvalidFields(
  data: Record<string, unknown> | undefined,
  checkers: FieldCheckers,
): string[] {
  return Object.entries(checkers)
    .filter(([field, check]) => !check(data?.[field]))
    .map(([field]) => field);
}

/**
 * Logs a warning with the raw, still-base64-encoded topic/value XDR for a
 * known event name whose decoded payload didn't match its expected shape.
 * Deliberately logs the raw XDR, not just the decoded (and therefore
 * already-possibly-wrong) data — the same raw-RPC-output inspection this
 * session actually used to root-cause the original macro-encoding bug.
 */
function warnShapeMismatch(eventName: string, raw: RawEvent, problems: string[]): void {
  logger.warn("parse", `"${eventName}" event payload didn't match its expected shape`, {
    eventName,
    problems,
    topic: raw.topic,
    value: raw.value,
    txHash: raw.txHash,
  });
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
      const problems = missingOrInvalidFields(data, { device_type: isString });
      if (problems.length > 0) {
        warnShapeMismatch("reg_dev", raw, problems);
        return null;
      }
      return { kind: "device_registered", device: subject, deviceType: data.device_type as string, ...common };
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
      const problems = missingOrInvalidFields(data, { reason: isString });
      if (problems.length > 0) {
        warnShapeMismatch("device_deactivated", raw, problems);
        return null;
      }
      return { kind: "device_deactivated", device: subject, reason: data.reason as string, ...common };
    }
    case "reading": {
      const data = decode(raw.value) as Record<string, unknown>;
      const problems = missingOrInvalidFields(data, {
        region_code: isNumberLike,
        epoch: isNumberLike,
        value: isNumberLike,
        accepted: isBoolean,
      });
      if (problems.length > 0) {
        warnShapeMismatch("reading", raw, problems);
        return null;
      }
      return {
        kind: "reading",
        device: subject,
        regionCode: Number(data.region_code),
        epoch: Number(data.epoch),
        value: Number(data.value),
        accepted: Boolean(data.accepted),
        ...common,
      };
    }
    case "claimed": {
      const data = decode(raw.value) as Record<string, unknown>;
      const problems = missingOrInvalidFields(data, { epoch: isNumberLike, payout: isNumberLike });
      if (problems.length > 0) {
        warnShapeMismatch("claimed", raw, problems);
        return null;
      }
      return {
        kind: "claimed",
        device: subject,
        epoch: Number(data.epoch),
        payout: BigInt(data.payout as bigint | number),
        ...common,
      };
    }
    case "subscribe": {
      const data = decode(raw.value) as Record<string, unknown>;
      const problems = missingOrInvalidFields(data, {
        periods: isNumberLike,
        new_expiry: isNumberLike,
      });
      if (problems.length > 0) {
        warnShapeMismatch("subscribe", raw, problems);
        return null;
      }
      return {
        kind: "subscribed",
        subscriber: subject,
        periods: Number(data.periods),
        expiry: BigInt(data.new_expiry as bigint | number),
        ...common,
      };
    }
    case "dispute_raised": {
      const data = decode(raw.value) as Record<string, unknown>;
      const problems = missingOrInvalidFields(data, {
        disputer: isString,
        evidence_hash: isNumberLike,
        open_dispute_count: isNumberLike,
      });
      if (problems.length > 0) {
        warnShapeMismatch("dispute_raised", raw, problems);
        return null;
      }
      return {
        kind: "dispute_raised",
        device: subject,
        disputer: data.disputer as string,
        evidenceHash: BigInt(data.evidence_hash as bigint | number),
        openDisputeCount: Number(data.open_dispute_count),
        ...common,
      };
    }
    case "dispute_resolved": {
      const data = decode(raw.value) as Record<string, unknown>;
      const problems = missingOrInvalidFields(data, {
        upheld: isBoolean,
        upheld_total: isNumberLike,
        device_active: isBoolean,
      });
      if (problems.length > 0) {
        warnShapeMismatch("dispute_resolved", raw, problems);
        return null;
      }
      return {
        kind: "dispute_resolved",
        device: subject,
        upheld: data.upheld as boolean,
        upheldTotal: Number(data.upheld_total),
        deviceActive: data.device_active as boolean,
        ...common,
      };
    }
    case "auto_slash_threshold_reached": {
      const data = decode(raw.value) as Record<string, unknown>;
      const problems = missingOrInvalidFields(data, {
        rejected_count: isNumberLike,
        threshold: isNumberLike,
      });
      if (problems.length > 0) {
        warnShapeMismatch("auto_slash_threshold_reached", raw, problems);
        return null;
      }
      return {
        kind: "auto_slash_threshold_reached",
        device: subject,
        rejectedCount: Number(data.rejected_count),
        threshold: Number(data.threshold),
        ...common,
      };
    }
    default:
      return null;
  }
}
