import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { openDb, type Db } from "../src/db/client.js";
import * as repo from "../src/db/repository.js";
import { loadConfig } from "../src/config.js";
import type { RawEvent } from "../src/stellar/parse.js";

const { fetchEventsMock, latestLedgerMock, fetchDeviceRecordMock } = vi.hoisted(() => ({
  fetchEventsMock: vi.fn(),
  latestLedgerMock: vi.fn(),
  fetchDeviceRecordMock: vi.fn(),
}));

vi.mock("../src/stellar/rpc.js", () => ({
  fetchEvents: fetchEventsMock,
  latestLedger: latestLedgerMock,
}));

vi.mock("../src/stellar/registry.js", () => ({
  fetchDeviceRecord: fetchDeviceRecordMock,
}));

// Imported after the mock so pollOnce picks up the mocked rpc module.
const { pollOnce, startPolling } = await import("../src/ingest/poller.js");

function b64(scVal: xdr.ScVal): string {
  return scVal.toXDR("base64");
}

/** #[contractevent] encodes a struct's non-#[topic] fields as a single
 * SCV_MAP keyed by field name — matches what the real on-chain events
 * actually look like now, not a bare value or positional vec. */
function map(fields: Record<string, xdr.ScVal>): string {
  const entries = Object.entries(fields).map(
    ([key, val]) => new xdr.ScMapEntry({ key: nativeToScVal(key, { type: "symbol" }), val }),
  );
  return b64(xdr.ScVal.scvMap(entries));
}

describe("poller", () => {
  let db: Db;
  const device = Keypair.random().publicKey();

  beforeEach(() => {
    db = openDb(":memory:");
    fetchEventsMock.mockReset();
    latestLedgerMock.mockReset();
    fetchDeviceRecordMock.mockReset();
  });

  it("seeds a brand-new contract's cursor from the current ledger, then ingests its events", async () => {
    latestLedgerMock.mockResolvedValue(5000);

    const readingEvent: RawEvent = {
      contractId: "CVALIDATOR",
      topic: [
        b64(nativeToScVal("reading", { type: "symbol" })),
        b64(nativeToScVal(device, { type: "address" })),
      ],
      value: map({
        region_code: nativeToScVal(42, { type: "u32" }),
        epoch: nativeToScVal(7, { type: "u32" }),
        value: nativeToScVal(2500, { type: "i32" }),
        accepted: nativeToScVal(true, { type: "bool" }),
      }),
      ledger: 5010,
      ledgerClosedAt: "2026-01-01T00:00:00Z",
      txHash: "TX1",
    };

    fetchEventsMock.mockResolvedValue({ events: [readingEvent], latestLedger: 5010 });

    const config = loadConfig({ SUBMISSION_VALIDATOR_CONTRACT_ID: "CVALIDATOR" });
    await pollOnce({ db, config });

    expect(latestLedgerMock).toHaveBeenCalledWith(config.rpcUrl);
    expect(fetchEventsMock).toHaveBeenCalledWith(
      expect.objectContaining({ contractIds: ["CVALIDATOR"], startLedger: 5000 }),
    );
    expect(repo.listReadingsForDevice(db, device).data).toHaveLength(1);
    expect(repo.getCursor(db, "CVALIDATOR")).toBe(5010);
  });

  it("resumes from the stored cursor on a later poll instead of re-seeding from latest ledger", async () => {
    repo.setCursor(db, "CVALIDATOR", 6000);
    fetchEventsMock.mockResolvedValue({ events: [], latestLedger: 6500 });

    const config = loadConfig({ SUBMISSION_VALIDATOR_CONTRACT_ID: "CVALIDATOR" });
    await pollOnce({ db, config });

    expect(latestLedgerMock).not.toHaveBeenCalled();
    expect(fetchEventsMock).toHaveBeenCalledWith(
      expect.objectContaining({ startLedger: 6000 }),
    );
    expect(repo.getCursor(db, "CVALIDATOR")).toBe(6500);
  });

  it("skips contracts that aren't configured", async () => {
    const config = loadConfig({}); // nothing configured
    await pollOnce({ db, config });
    expect(fetchEventsMock).not.toHaveBeenCalled();
  });

  it("enriches a device_registered event with owner/lat/lon via a direct read", async () => {
    latestLedgerMock.mockResolvedValue(5000);
    fetchDeviceRecordMock.mockResolvedValue({
      owner: "GOWNER",
      deviceType: "weather",
      lat: 404500,
      lon: -736900,
      active: true,
    });

    const regEvent: RawEvent = {
      contractId: "CREGISTRY",
      topic: [
        b64(nativeToScVal("reg_dev", { type: "symbol" })),
        b64(nativeToScVal(device, { type: "address" })),
      ],
      value: map({ device_type: nativeToScVal("weather", { type: "symbol" }) }),
      ledger: 5010,
      ledgerClosedAt: "2026-01-01T00:00:00Z",
      txHash: "TX2",
    };
    fetchEventsMock.mockResolvedValue({ events: [regEvent], latestLedger: 5010 });

    const config = loadConfig({ DEVICE_REGISTRY_CONTRACT_ID: "CREGISTRY" });
    await pollOnce({ db, config });

    expect(fetchDeviceRecordMock).toHaveBeenCalledWith(
      config.rpcUrl,
      config.networkPassphrase,
      "CREGISTRY",
      device,
    );
    const stored = repo.getDevice(db, device);
    expect(stored).toMatchObject({ owner: "GOWNER", lat: 404500, lon: -736900, active: 1 });
  });

  it("leaves owner/lat/lon null when enrichment fails, rather than failing the poll", async () => {
    latestLedgerMock.mockResolvedValue(5000);
    fetchDeviceRecordMock.mockResolvedValue(null);

    const regEvent: RawEvent = {
      contractId: "CREGISTRY",
      topic: [
        b64(nativeToScVal("reg_dev", { type: "symbol" })),
        b64(nativeToScVal(device, { type: "address" })),
      ],
      value: map({ device_type: nativeToScVal("weather", { type: "symbol" }) }),
      ledger: 5010,
      ledgerClosedAt: "2026-01-01T00:00:00Z",
      txHash: "TX3",
    };
    fetchEventsMock.mockResolvedValue({ events: [regEvent], latestLedger: 5010 });

    const config = loadConfig({ DEVICE_REGISTRY_CONTRACT_ID: "CREGISTRY" });
    await pollOnce({ db, config });

    const stored = repo.getDevice(db, device);
    expect(stored).toMatchObject({ owner: null, lat: null, lon: null, device_type: "weather" });
  });

  it("ingests a dispute_raised event, incrementing the device's open_disputes count", async () => {
    latestLedgerMock.mockResolvedValue(5000);
    repo.upsertDevice(db, {
      address: device,
      owner: null,
      device_type: "weather",
      lat: null,
      lon: null,
      registered_at: 1000,
    });
    const disputer = Keypair.random().publicKey();

    const disputeEvent: RawEvent = {
      contractId: "CREGISTRY",
      topic: [
        b64(nativeToScVal("dispute_raised", { type: "symbol" })),
        b64(nativeToScVal(device, { type: "address" })),
      ],
      value: map({
        disputer: nativeToScVal(disputer, { type: "address" }),
        evidence_hash: nativeToScVal(42n, { type: "u64" }),
        open_dispute_count: nativeToScVal(1, { type: "u32" }),
      }),
      ledger: 5010,
      ledgerClosedAt: "2026-01-01T00:00:00Z",
      txHash: "TX_DISPUTE",
    };
    fetchEventsMock.mockResolvedValue({ events: [disputeEvent], latestLedger: 5010 });

    const config = loadConfig({ DEVICE_REGISTRY_CONTRACT_ID: "CREGISTRY" });
    await pollOnce({ db, config });

    expect(repo.getDevice(db, device)?.open_disputes).toBe(1);
    expect(repo.listDisputesForDevice(db, device)).toMatchObject([{ disputer, status: "open" }]);
  });

  it("ingests a dispute_resolved event and sets the device's active state from it directly", async () => {
    latestLedgerMock.mockResolvedValue(5000);
    repo.upsertDevice(db, {
      address: device,
      owner: null,
      device_type: "weather",
      lat: null,
      lon: null,
      registered_at: 1000,
    });
    repo.insertDispute(db, {
      device_address: device,
      disputer: Keypair.random().publicKey(),
      evidence_hash: "1",
      raised_ledger: 100,
      raised_closed_at: "2026-01-01T00:00:00Z",
      raised_tx_hash: "TX_RAISE",
    });

    const resolvedEvent: RawEvent = {
      contractId: "CREGISTRY",
      topic: [
        b64(nativeToScVal("dispute_resolved", { type: "symbol" })),
        b64(nativeToScVal(device, { type: "address" })),
      ],
      value: map({
        upheld: nativeToScVal(true, { type: "bool" }),
        upheld_total: nativeToScVal(1, { type: "u32" }),
        device_active: nativeToScVal(false, { type: "bool" }),
      }),
      ledger: 5010,
      ledgerClosedAt: "2026-01-01T00:00:00Z",
      txHash: "TX_RESOLVE",
    };
    fetchEventsMock.mockResolvedValue({ events: [resolvedEvent], latestLedger: 5010 });

    const config = loadConfig({ DEVICE_REGISTRY_CONTRACT_ID: "CREGISTRY" });
    await pollOnce({ db, config });

    const stored = repo.getDevice(db, device);
    expect(stored).toMatchObject({ active: 0, open_disputes: 0, upheld_disputes: 1 });
  });

  it("ingests an auto_slash_threshold_reached event without throwing", async () => {
    latestLedgerMock.mockResolvedValue(5000);

    const autoSlashEvent: RawEvent = {
      contractId: "CVALIDATOR",
      topic: [
        b64(nativeToScVal("auto_slash_threshold_reached", { type: "symbol" })),
        b64(nativeToScVal(device, { type: "address" })),
      ],
      value: map({
        rejected_count: nativeToScVal(3, { type: "u32" }),
        threshold: nativeToScVal(3, { type: "u32" }),
      }),
      ledger: 5010,
      ledgerClosedAt: "2026-01-01T00:00:00Z",
      txHash: "TX_AUTO_SLASH",
    };
    fetchEventsMock.mockResolvedValue({ events: [autoSlashEvent], latestLedger: 5010 });

    const config = loadConfig({ SUBMISSION_VALIDATOR_CONTRACT_ID: "CVALIDATOR" });
    await expect(pollOnce({ db, config })).resolves.not.toThrow();
  });
});

describe("startPolling", () => {
  beforeEach(() => {
    fetchEventsMock.mockReset();
    latestLedgerMock.mockReset();
  });

  it("stop() prevents any further poll cycle from starting", async () => {
    latestLedgerMock.mockResolvedValue(5000);
    fetchEventsMock.mockResolvedValue({ events: [], latestLedger: 5000 });

    const db = openDb(":memory:");
    const config = loadConfig({ SUBMISSION_VALIDATOR_CONTRACT_ID: "CVALIDATOR" });
    const handle = startPolling({ db, config }, 10_000);

    await handle.whenIdle();
    const callsBeforeStop = fetchEventsMock.mock.calls.length;

    handle.stop();
    // Long enough that a scheduled next tick would have fired if stop()
    // hadn't cancelled it.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(fetchEventsMock.mock.calls.length).toBe(callsBeforeStop);
  });

  it("whenIdle() resolves only once the in-flight tick has actually finished", async () => {
    latestLedgerMock.mockResolvedValue(5000);
    let resolveFetch!: (value: { events: never[]; latestLedger: number }) => void;
    fetchEventsMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const db = openDb(":memory:");
    const config = loadConfig({ SUBMISSION_VALIDATOR_CONTRACT_ID: "CVALIDATOR" });
    const handle = startPolling({ db, config }, 10_000);

    let idleResolved = false;
    const idle = handle.whenIdle().then(() => {
      idleResolved = true;
    });

    // The tick is still awaiting fetchEvents — whenIdle must not have
    // resolved yet.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(idleResolved).toBe(false);

    resolveFetch({ events: [], latestLedger: 5000 });
    await idle;
    expect(idleResolved).toBe(true);

    handle.stop();
  });
});
