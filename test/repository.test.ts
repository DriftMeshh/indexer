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

    expect(repo.listReadingsForDevice(db, "DEV1")).toHaveLength(1);
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
});
