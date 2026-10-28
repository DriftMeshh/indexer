import { describe, expect, it } from "vitest";
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

function vec(...items: xdr.ScVal[]): string {
  return b64(xdr.ScVal.scvVec(items));
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
      value: b64(nativeToScVal("weather", { type: "symbol" })),
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
      value: vec(
        nativeToScVal(42, { type: "u32" }),
        nativeToScVal(7, { type: "u32" }),
        nativeToScVal(2500, { type: "i32" }),
        nativeToScVal(true, { type: "bool" }),
      ),
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
      value: vec(
        nativeToScVal(42, { type: "u32" }),
        nativeToScVal(7, { type: "u32" }),
        nativeToScVal(999999, { type: "i32" }),
        nativeToScVal(false, { type: "bool" }),
      ),
    });

    const parsed = parseEvent(raw);
    expect(parsed).toMatchObject({ kind: "reading", accepted: false });
  });

  it("parses a claimed event with an i128 payout", () => {
    const raw = makeRaw({
      topic: [symbolTopic("claimed"), addressTopic(device)],
      value: vec(nativeToScVal(7, { type: "u32" }), nativeToScVal(150n, { type: "i128" })),
    });

    const parsed = parseEvent(raw);
    expect(parsed).toMatchObject({ kind: "claimed", device, epoch: 7, payout: 150n });
  });

  it("parses a subscribed event with a u64 expiry", () => {
    const raw = makeRaw({
      topic: [symbolTopic("subscribe"), addressTopic(subscriber)],
      value: vec(
        nativeToScVal(3, { type: "u32" }),
        nativeToScVal(1_893_456_000n, { type: "u64" }),
      ),
    });

    const parsed = parseEvent(raw);
    expect(parsed).toMatchObject({
      kind: "subscribed",
      subscriber,
      periods: 3,
      expiry: 1_893_456_000n,
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
