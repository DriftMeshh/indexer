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
const { pollOnce } = await import("../src/ingest/poller.js");

function b64(scVal: xdr.ScVal): string {
  return scVal.toXDR("base64");
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
      value: b64(
        xdr.ScVal.scvVec([
          nativeToScVal(42, { type: "u32" }),
          nativeToScVal(7, { type: "u32" }),
          nativeToScVal(2500, { type: "i32" }),
          nativeToScVal(true, { type: "bool" }),
        ]),
      ),
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
    expect(repo.listReadingsForDevice(db, device)).toHaveLength(1);
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
      value: b64(nativeToScVal("weather", { type: "symbol" })),
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
      value: b64(nativeToScVal("weather", { type: "symbol" })),
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
});
