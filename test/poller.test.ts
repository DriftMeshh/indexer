import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { openDb, type Db } from "../src/db/client.js";
import * as repo from "../src/db/repository.js";
import { loadConfig } from "../src/config.js";
import type { RawEvent } from "../src/stellar/parse.js";

const { fetchEventsMock, latestLedgerMock } = vi.hoisted(() => ({
  fetchEventsMock: vi.fn(),
  latestLedgerMock: vi.fn(),
}));

vi.mock("../src/stellar/rpc.js", () => ({
  fetchEvents: fetchEventsMock,
  latestLedger: latestLedgerMock,
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
});
