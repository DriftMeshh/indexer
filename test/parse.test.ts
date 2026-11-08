import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { parseEvent, type RawEvent } from "../src/stellar/parse.js";

function b64(scVal: xdr.ScVal): string {
  return scVal.toXDR("base64");
}

function symbolTopic(name: string): string {
  return b64(nativeToScVal(name, { type: "symbol" }));
}

function addressTopic(address: string): string {
  return b64(nativeToScVal(address, { type: "address" }));
}

/** #[contractevent] encodes a struct's non-#[topic] fields as a single
 * SCV_MAP keyed by field name — this is what every real event's `value`
 * actually looks like now, not a bare value or positional vec. */
function map(fields: Record<string, xdr.ScVal>): string {
  const entries = Object.entries(fields).map(
    ([key, val]) => new xdr.ScMapEntry({ key: nativeToScVal(key, { type: "symbol" }), val }),
  );
  return b64(xdr.ScVal.scvMap(entries));
}

function makeRaw(overrides: Partial<RawEvent>): RawEvent {
  return {
    contractId: "CCONTRACT",
    topic: [],
    value: b64(xdr.ScVal.scvVoid()),
    ledger: 1000,
    ledgerClosedAt: "2026-01-01T00:00:00Z",
    txHash: "deadbeef",
    ...overrides,
  };
}

describe("parseEvent", () => {
  const device = Keypair.random().publicKey();
  const subscriber = Keypair.random().publicKey();

  it("parses a device_registered event", () => {
    const raw = makeRaw({
      topic: [symbolTopic("reg_dev"), addressTopic(device)],
      value: map({ device_type: nativeToScVal("weather", { type: "symbol" }) }),
    });

    const parsed = parseEvent(raw);
    expect(parsed).toEqual({
      kind: "device_registered",
      device,
      deviceType: "weather",
      ledger: 1000,
      closedAt: "2026-01-01T00:00:00Z",
      txHash: "deadbeef",
    });
  });

  it("parses an accepted reading event", () => {
    const raw = makeRaw({
      topic: [symbolTopic("reading"), addressTopic(device)],
      value: map({
        region_code: nativeToScVal(42, { type: "u32" }),
        epoch: nativeToScVal(7, { type: "u32" }),
        value: nativeToScVal(2500, { type: "i32" }),
        accepted: nativeToScVal(true, { type: "bool" }),
      }),
    });

    const parsed = parseEvent(raw);
    expect(parsed).toMatchObject({
      kind: "reading",
      device,
      regionCode: 42,
      epoch: 7,
      value: 2500,
      accepted: true,
    });
  });

  it("parses a rejected reading event", () => {
    const raw = makeRaw({
      topic: [symbolTopic("reading"), addressTopic(device)],
      value: map({
        region_code: nativeToScVal(42, { type: "u32" }),
        epoch: nativeToScVal(7, { type: "u32" }),
        value: nativeToScVal(999999, { type: "i32" }),
        accepted: nativeToScVal(false, { type: "bool" }),
      }),
    });

    const parsed = parseEvent(raw);
    expect(parsed).toMatchObject({ kind: "reading", accepted: false });
  });

  it("parses a claimed event with an i128 payout", () => {
    const raw = makeRaw({
      topic: [symbolTopic("claimed"), addressTopic(device)],
      value: map({
        epoch: nativeToScVal(7, { type: "u32" }),
        payout: nativeToScVal(150n, { type: "i128" }),
      }),
    });

    const parsed = parseEvent(raw);
    expect(parsed).toMatchObject({ kind: "claimed", device, epoch: 7, payout: 150n });
  });

  it("parses a subscribed event with a u64 expiry", () => {
    const raw = makeRaw({
      topic: [symbolTopic("subscribe"), addressTopic(subscriber)],
      value: map({
        periods: nativeToScVal(3, { type: "u32" }),
        new_expiry: nativeToScVal(1_893_456_000n, { type: "u64" }),
      }),
    });

    const parsed = parseEvent(raw);
    expect(parsed).toMatchObject({
      kind: "subscribed",
      subscriber,
      periods: 3,
      expiry: 1_893_456_000n,
    });
  });

  it("parses a device_deactivated event", () => {
    // Topic is "device_deactivated" (heck::ToSnakeCase of the contract's
    // `DeviceDeactivated` struct name) — an earlier version of this parser
    // guessed "deact_dev" instead, which never matched the real on-chain
    // topic and silently dropped every deactivation.
    const raw = makeRaw({
      topic: [symbolTopic("device_deactivated"), addressTopic(device)],
      value: map({ reason: nativeToScVal("admin", { type: "symbol" }) }),
    });

    const parsed = parseEvent(raw);
    expect(parsed).toEqual({
      kind: "device_deactivated",
      device,
      reason: "admin",
      ledger: 1000,
      closedAt: "2026-01-01T00:00:00Z",
      txHash: "deadbeef",
    });
  });

  it("returns null for a device_deactivated event missing its reason field", () => {
    const raw = makeRaw({
      topic: [symbolTopic("device_deactivated"), addressTopic(device)],
      value: map({}),
    });
    expect(parseEvent(raw)).toBeNull();
  });

  it("parses a dispute_raised event", () => {
    const disputer = Keypair.random().publicKey();
    const raw = makeRaw({
      topic: [symbolTopic("dispute_raised"), addressTopic(device)],
      value: map({
        disputer: nativeToScVal(disputer, { type: "address" }),
        evidence_hash: nativeToScVal(123456789n, { type: "u64" }),
        open_dispute_count: nativeToScVal(1, { type: "u32" }),
      }),
    });

    expect(parseEvent(raw)).toEqual({
      kind: "dispute_raised",
      device,
      disputer,
      evidenceHash: 123456789n,
      openDisputeCount: 1,
      ledger: 1000,
      closedAt: "2026-01-01T00:00:00Z",
      txHash: "deadbeef",
    });
  });

  it("returns null for a dispute_raised event missing a required field", () => {
    const raw = makeRaw({
      topic: [symbolTopic("dispute_raised"), addressTopic(device)],
      value: map({ disputer: nativeToScVal(device, { type: "address" }) }),
    });
    expect(parseEvent(raw)).toBeNull();
  });

  it("parses a dispute_resolved event (upheld)", () => {
    const raw = makeRaw({
      topic: [symbolTopic("dispute_resolved"), addressTopic(device)],
      value: map({
        upheld: nativeToScVal(true, { type: "bool" }),
        upheld_total: nativeToScVal(2, { type: "u32" }),
        device_active: nativeToScVal(false, { type: "bool" }),
      }),
    });

    expect(parseEvent(raw)).toEqual({
      kind: "dispute_resolved",
      device,
      upheld: true,
      upheldTotal: 2,
      deviceActive: false,
      ledger: 1000,
      closedAt: "2026-01-01T00:00:00Z",
      txHash: "deadbeef",
    });
  });

  it("parses a dispute_resolved event (dismissed)", () => {
    const raw = makeRaw({
      topic: [symbolTopic("dispute_resolved"), addressTopic(device)],
      value: map({
        upheld: nativeToScVal(false, { type: "bool" }),
        upheld_total: nativeToScVal(0, { type: "u32" }),
        device_active: nativeToScVal(true, { type: "bool" }),
      }),
    });

    expect(parseEvent(raw)).toEqual({
      kind: "dispute_resolved",
      device,
      upheld: false,
      upheldTotal: 0,
      deviceActive: true,
      ledger: 1000,
      closedAt: "2026-01-01T00:00:00Z",
      txHash: "deadbeef",
    });
  });

  it("parses an auto_slash_threshold_reached event", () => {
    const raw = makeRaw({
      topic: [symbolTopic("auto_slash_threshold_reached"), addressTopic(device)],
      value: map({
        rejected_count: nativeToScVal(3, { type: "u32" }),
        threshold: nativeToScVal(3, { type: "u32" }),
      }),
    });

    expect(parseEvent(raw)).toEqual({
      kind: "auto_slash_threshold_reached",
      device,
      rejectedCount: 3,
      threshold: 3,
      ledger: 1000,
      closedAt: "2026-01-01T00:00:00Z",
      txHash: "deadbeef",
    });
  });

  it("returns null for an unrecognised event name", () => {
    const raw = makeRaw({
      topic: [symbolTopic("some_other_event"), addressTopic(device)],
      value: b64(xdr.ScVal.scvVoid()),
    });
    expect(parseEvent(raw)).toBeNull();
  });

  it("returns null for an event with fewer than two topics", () => {
    const raw = makeRaw({ topic: [symbolTopic("reg_dev")] });
    expect(parseEvent(raw)).toBeNull();
  });
});

describe("parseEvent shape-mismatch warnings", () => {
  const device = Keypair.random().publicKey();
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("logs a warning naming the missing field for a reg_dev event with no device_type", () => {
    const raw = makeRaw({
      topic: [symbolTopic("reg_dev"), addressTopic(device)],
      value: map({}),
    });

    expect(parseEvent(raw)).toBeNull();
    expect(logSpy).toHaveBeenCalledOnce();
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed).toMatchObject({
      level: "warn",
      scope: "parse",
      meta: { eventName: "reg_dev", problems: ["device_type"] },
    });
    // The raw, still-encoded XDR is included so a real mismatch can be
    // root-caused directly from the log line, not just "something's wrong".
    expect(parsed.meta.topic).toEqual(raw.topic);
    expect(parsed.meta.value).toEqual(raw.value);
  });

  it("logs a warning naming the field when it's present but the wrong type", () => {
    const raw = makeRaw({
      topic: [symbolTopic("reg_dev"), addressTopic(device)],
      // device_type as a bool instead of the expected symbol/string —
      // simulates exactly the class of contract-side encoding change
      // this validation exists to catch.
      value: map({ device_type: nativeToScVal(true, { type: "bool" }) }),
    });

    expect(parseEvent(raw)).toBeNull();
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed.meta.problems).toEqual(["device_type"]);
  });

  it("names every missing field, not just the first, for a multi-field event", () => {
    const raw = makeRaw({
      topic: [symbolTopic("dispute_raised"), addressTopic(device)],
      value: map({ disputer: nativeToScVal(device, { type: "address" }) }),
    });

    expect(parseEvent(raw)).toBeNull();
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed.meta.problems.sort()).toEqual(["evidence_hash", "open_dispute_count"]);
  });

  it("does not warn for a genuinely unrecognised event name (not a shape mismatch)", () => {
    const raw = makeRaw({
      topic: [symbolTopic("some_future_event"), addressTopic(device)],
      value: map({ anything: nativeToScVal(1, { type: "u32" }) }),
    });

    expect(parseEvent(raw)).toBeNull();
    expect(logSpy).not.toHaveBeenCalled();
  });
});
