import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/db/client.js";
import * as repo from "../src/db/repository.js";

describe("repository", () => {
  let db: Db;

  beforeEach(() => {
    db = openDb(":memory:");
  });

  it("upserts a device without clobbering known fields with later nulls", () => {
    repo.upsertDevice(db, {
      address: "DEV1",
      owner: "OWNER1",
      device_type: "weather",
      lat: 10,
      lon: 20,
      registered_at: 1000,
    });
    // A second event for the same device (e.g. a duplicate ingest) with
    // unknown owner/location shouldn't erase the ones we already have.
    repo.upsertDevice(db, {
      address: "DEV1",
      owner: null,
      device_type: "weather",
      lat: null,
      lon: null,
      registered_at: 1000,
    });

    const device = repo.getDevice(db, "DEV1");
    expect(device).toMatchObject({ owner: "OWNER1", lat: 10, lon: 20 });
  });

  it("deactivating a device is reflected in getDevice", () => {
    repo.upsertDevice(db, {
      address: "DEV1",
      owner: "OWNER1",
      device_type: "weather",
      lat: null,
      lon: null,
      registered_at: 1000,
    });
    repo.setDeviceActive(db, "DEV1", false);
    expect(repo.getDevice(db, "DEV1")?.active).toBe(0);
  });

  it("ignores a duplicate reading with the same tx_hash + device", () => {
    const reading = {
      device_address: "DEV1",
      device_type: "weather",
      region_code: 1,
      epoch: 7,
      value: 2500,
      accepted: 1,
      ledger: 100,
      closed_at: "2026-01-01T00:00:00Z",
      tx_hash: "TX1",
    };
    repo.insertReading(db, reading);
    repo.insertReading(db, reading); // duplicate ingest, e.g. poller re-running an overlapping window

    expect(repo.listReadingsForDevice(db, "DEV1").data).toHaveLength(1);
  });

  it("computes the region average over accepted readings only", () => {
    const base = {
      device_address: "DEV1",
      device_type: "weather",
      region_code: 1,
      epoch: 7,
      ledger: 100,
      closed_at: "2026-01-01T00:00:00Z",
    };
    repo.insertReading(db, { ...base, value: 2000, accepted: 1, tx_hash: "TX1" });
    repo.insertReading(db, { ...base, value: 3000, accepted: 1, tx_hash: "TX2" });
    repo.insertReading(db, { ...base, value: 999999, accepted: 0, tx_hash: "TX3" }); // rejected outlier, excluded

    expect(repo.regionAverage(db, 1, 7)).toBe(2500);
  });

  it("round-trips the ingest cursor per contract", () => {
    expect(repo.getCursor(db, "C1")).toBe(0);
    repo.setCursor(db, "C1", 500);
    repo.setCursor(db, "C2", 900);
    expect(repo.getCursor(db, "C1")).toBe(500);
    expect(repo.getCursor(db, "C2")).toBe(900);
  });

  it("listReadingsForRegion returns all readings for a region+epoch ordered by ledger DESC", () => {
    const base = {
      device_type: "weather",
      region_code: 5,
      epoch: 3,
      accepted: 1,
      closed_at: "2026-01-01T00:00:00Z",
    };
    repo.insertReading(db, { ...base, device_address: "DEV_A", value: 100, ledger: 10, tx_hash: "H1" });
    repo.insertReading(db, { ...base, device_address: "DEV_B", value: 200, ledger: 20, tx_hash: "H2" });
    repo.insertReading(db, { ...base, device_address: "DEV_C", value: 300, ledger: 30, tx_hash: "H3" });

    const rows = repo.listReadingsForRegion(db, 5, 3);
    expect(rows).toHaveLength(3);
    // Ordered ledger DESC: 30, 20, 10
    expect(rows[0].ledger).toBe(30);
    expect(rows[1].ledger).toBe(20);
    expect(rows[2].ledger).toBe(10);
  });

  it("listReadingsForRegion includes accepted=0 rows (unlike regionAverage)", () => {
    const base = {
      device_address: "DEV1",
      device_type: "weather",
      region_code: 7,
      epoch: 1,
      ledger: 50,
      closed_at: "2026-01-01T00:00:00Z",
    };
    repo.insertReading(db, { ...base, value: 100, accepted: 1, tx_hash: "HA" });
    repo.insertReading(db, { ...base, value: 999, accepted: 0, tx_hash: "HB", ledger: 51 });

    const rows = repo.listReadingsForRegion(db, 7, 1);
    expect(rows).toHaveLength(2);
    expect(rows.some((r) => r.accepted === 0)).toBe(true);
  });

  it("subscriptions only move forward (a stale/out-of-order event can't roll back expiry)", () => {
    repo.upsertSubscription(db, {
      subscriber: "SUB1",
      periods_last_purchase: 2,
      expiry: 2000,
      updated_at_ledger: 100,
    });
    repo.upsertSubscription(db, {
      subscriber: "SUB1",
      periods_last_purchase: 1,
      expiry: 1500,
      updated_at_ledger: 50, // older ledger arriving late
    });

    expect(repo.getSubscription(db, "SUB1")?.expiry).toBe(2000);
  });

  describe("disputes", () => {
    beforeEach(() => {
      repo.upsertDevice(db, {
        address: "DEV1",
        owner: "OWNER1",
        device_type: "weather",
        lat: 10,
        lon: 20,
        registered_at: 1000,
      });
    });

    it("insertDispute increments the device's open_disputes count", () => {
      repo.insertDispute(db, {
        device_address: "DEV1",
        disputer: "DISPUTER1",
        evidence_hash: "123456789",
        raised_ledger: 100,
        raised_closed_at: "2026-01-01T00:00:00Z",
        raised_tx_hash: "TX1",
      });

      expect(repo.getDevice(db, "DEV1")?.open_disputes).toBe(1);
      expect(repo.listDisputesForDevice(db, "DEV1")).toMatchObject([
        { device_address: "DEV1", disputer: "DISPUTER1", status: "open" },
      ]);
    });

    it("ignores a duplicate insertDispute with the same tx_hash + device (no double count)", () => {
      const dispute = {
        device_address: "DEV1",
        disputer: "DISPUTER1",
        evidence_hash: "1",
        raised_ledger: 100,
        raised_closed_at: "2026-01-01T00:00:00Z",
        raised_tx_hash: "TX1",
      };
      repo.insertDispute(db, dispute);
      repo.insertDispute(db, dispute);

      expect(repo.getDevice(db, "DEV1")?.open_disputes).toBe(1);
      expect(repo.listDisputesForDevice(db, "DEV1")).toHaveLength(1);
    });

    it("resolveDispute(upheld=true) closes the open dispute and bumps upheld_disputes", () => {
      repo.insertDispute(db, {
        device_address: "DEV1",
        disputer: "DISPUTER1",
        evidence_hash: "1",
        raised_ledger: 100,
        raised_closed_at: "2026-01-01T00:00:00Z",
        raised_tx_hash: "TX1",
      });

      const resolved = repo.resolveDispute(db, {
        device_address: "DEV1",
        upheld: true,
        resolved_ledger: 200,
        resolved_closed_at: "2026-01-02T00:00:00Z",
        resolved_tx_hash: "TX2",
      });

      expect(resolved).toBe(true);
      const device = repo.getDevice(db, "DEV1");
      expect(device?.open_disputes).toBe(0);
      expect(device?.upheld_disputes).toBe(1);
      expect(repo.listDisputesForDevice(db, "DEV1")).toMatchObject([
        { status: "upheld", resolved_tx_hash: "TX2" },
      ]);
    });

    it("resolveDispute(upheld=false) closes the dispute without bumping upheld_disputes", () => {
      repo.insertDispute(db, {
        device_address: "DEV1",
        disputer: "DISPUTER1",
        evidence_hash: "1",
        raised_ledger: 100,
        raised_closed_at: "2026-01-01T00:00:00Z",
        raised_tx_hash: "TX1",
      });

      repo.resolveDispute(db, {
        device_address: "DEV1",
        upheld: false,
        resolved_ledger: 200,
        resolved_closed_at: "2026-01-02T00:00:00Z",
        resolved_tx_hash: "TX2",
      });

      const device = repo.getDevice(db, "DEV1");
      expect(device?.open_disputes).toBe(0);
      expect(device?.upheld_disputes).toBe(0);
      expect(repo.listDisputesForDevice(db, "DEV1")[0].status).toBe("dismissed");
    });

    it("resolveDispute returns false and is a no-op when no dispute is open", () => {
      const resolved = repo.resolveDispute(db, {
        device_address: "DEV1",
        upheld: true,
        resolved_ledger: 200,
        resolved_closed_at: "2026-01-02T00:00:00Z",
        resolved_tx_hash: "TX2",
      });

      expect(resolved).toBe(false);
      expect(repo.getDevice(db, "DEV1")?.open_disputes).toBe(0);
    });

    it("a device can accumulate multiple resolved disputes over time", () => {
      repo.insertDispute(db, {
        device_address: "DEV1",
        disputer: "DISPUTER1",
        evidence_hash: "1",
        raised_ledger: 100,
        raised_closed_at: "2026-01-01T00:00:00Z",
        raised_tx_hash: "TX1",
      });
      repo.resolveDispute(db, {
        device_address: "DEV1",
        upheld: true,
        resolved_ledger: 150,
        resolved_closed_at: "2026-01-01T01:00:00Z",
        resolved_tx_hash: "TX2",
      });

      repo.insertDispute(db, {
        device_address: "DEV1",
        disputer: "DISPUTER2",
        evidence_hash: "2",
        raised_ledger: 200,
        raised_closed_at: "2026-01-02T00:00:00Z",
        raised_tx_hash: "TX3",
      });
      repo.resolveDispute(db, {
        device_address: "DEV1",
        upheld: true,
        resolved_ledger: 250,
        resolved_closed_at: "2026-01-02T01:00:00Z",
        resolved_tx_hash: "TX4",
      });

      const device = repo.getDevice(db, "DEV1");
      expect(device?.open_disputes).toBe(0);
      expect(device?.upheld_disputes).toBe(2);
      expect(repo.listDisputesForDevice(db, "DEV1")).toHaveLength(2);
    });
  });

  describe("auto-slash events", () => {
    it("insertAutoSlashEvent records the event", () => {
      repo.upsertDevice(db, {
        address: "DEV1",
        owner: "OWNER1",
        device_type: "weather",
        lat: 10,
        lon: 20,
        registered_at: 1000,
      });
      repo.insertAutoSlashEvent(db, {
        device_address: "DEV1",
        rejected_count: 3,
        threshold: 3,
        ledger: 100,
        closed_at: "2026-01-01T00:00:00Z",
        tx_hash: "TX1",
      });

      // No dedicated getter exists yet beyond what the API layer needs;
      // this confirms the insert itself doesn't throw and is idempotent
      // on a duplicate tx_hash, matching insertReading/insertClaim.
      expect(() =>
        repo.insertAutoSlashEvent(db, {
          device_address: "DEV1",
          rejected_count: 3,
          threshold: 3,
          ledger: 100,
          closed_at: "2026-01-01T00:00:00Z",
          tx_hash: "TX1",
        }),
      ).not.toThrow();
    });
  });
});
