import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { openDb, type Db } from "../src/db/client.js";
import * as repo from "../src/db/repository.js";
import { createApp } from "../src/api/app.js";

describe("API", () => {
  let db: Db;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = openDb(":memory:");
    app = createApp(db);
    repo.upsertDevice(db, {
      address: "DEV1",
      owner: "OWNER1",
      device_type: "weather",
      lat: 10,
      lon: 20,
      registered_at: 1000,
    });
    repo.insertReading(db, {
      device_address: "DEV1",
      device_type: "weather",
      region_code: 42,
      epoch: 7,
      value: 2500,
      accepted: 1,
      ledger: 100,
      closed_at: "2026-01-01T00:00:00Z",
      tx_hash: "TX1",
    });
    repo.insertClaim(db, {
      device_address: "DEV1",
      epoch: 7,
      payout: "175",
      ledger: 101,
      closed_at: "2026-01-01T00:01:00Z",
      tx_hash: "TX2",
    });
  });

  it("GET /health", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("GET /devices lists registered devices", async () => {
    const res = await request(app).get("/devices");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].address).toBe("DEV1");
  });

  it("GET /devices/:address 404s for an unknown device", async () => {
    const res = await request(app).get("/devices/NOPE");
    expect(res.status).toBe(404);
  });

  it("GET /devices/:address/readings returns that device's readings", async () => {
    const res = await request(app).get("/devices/DEV1/readings");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ value: 2500, region_code: 42 });
  });

  it("GET /devices/:address/claims returns that device's claims", async () => {
    const res = await request(app).get("/devices/DEV1/claims");
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ epoch: 7, payout: "175" });
  });

  it("GET /regions/:code/average computes the region average", async () => {
    const res = await request(app).get("/regions/42/average?epoch=7");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ regionCode: 42, epoch: 7, average: 2500 });
  });

  it("GET /regions/:code/average 400s on a non-numeric epoch", async () => {
    const res = await request(app).get("/regions/42/average?epoch=not-a-number");
    expect(res.status).toBe(400);
  });

  it("GET /subscriptions/:address reports inactive for an unknown subscriber", async () => {
    const res = await request(app).get("/subscriptions/NOPE");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ active: false });
  });

  it("GET /subscriptions/:address reports active for a non-expired subscription", async () => {
    repo.upsertSubscription(db, {
      subscriber: "SUB1",
      periods_last_purchase: 1,
      expiry: Math.floor(Date.now() / 1000) + 10_000,
      updated_at_ledger: 1,
    });
    const res = await request(app).get("/subscriptions/SUB1");
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(true);
  });
});
