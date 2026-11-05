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

  it("GET /devices returns Content-Type application/json", async () => {
    const res = await request(app).get("/devices");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });

  it("GET /devices/:address/readings returns Content-Type application/json", async () => {
    const res = await request(app).get("/devices/DEV1/readings");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });

  it("GET /devices lists registered devices", async () => {
    const res = await request(app).get("/devices");
    expect(res.status).toBe(200);
    // Response is now a paginated envelope
    expect(res.body).toHaveProperty("data");
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].address).toBe("DEV1");
    expect(res.body.total).toBe(1);
    expect(res.body.offset).toBe(0);
  });

  it("GET /devices/:address 404s for an unknown device", async () => {
    const res = await request(app).get("/devices/NOPE");
    expect(res.status).toBe(404);
  });

  it("GET /devices with float limit truncates to integer", async () => {
    // limit=2.9 should be treated as limit=2 (Math.trunc behaviour)
    const res = await request(app).get("/devices?limit=2.9");
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(2);
  });

  it("GET /devices/:address/readings with float limit truncates to integer", async () => {
    const res = await request(app).get("/devices/DEV1/readings?limit=1.9");
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(1);
  });

  it("GET /devices/:address/readings returns that device's readings", async () => {
    const res = await request(app).get("/devices/DEV1/readings");
    expect(res.status).toBe(200);
    // Response is now a paginated envelope
    expect(res.body).toHaveProperty("data");
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ value: 2500, region_code: 42 });
    expect(res.body.total).toBe(1);
    expect(res.body.offset).toBe(0);
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

  it("GET /devices/:address/readings returns 200 with empty paginated envelope for unknown device", async () => {
    // An unknown device has 0 readings — valid response is an empty page, not 404
    const res = await request(app).get("/devices/UNKNOWN_ADDR/readings");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.total).toBe(0);
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

  // ── GET /readings ─────────────────────────────────────────────────────────

  it("GET /readings returns all readings for a region+epoch", async () => {
    const res = await request(app).get("/readings?region=42&epoch=7");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ value: 2500, region_code: 42, epoch: 7 });
  });

  it("GET /readings returns empty array when no readings match", async () => {
    const res = await request(app).get("/readings?region=99&epoch=1");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("GET /readings returns multiple readings across devices for same region+epoch", async () => {
    repo.upsertDevice(db, {
      address: "DEV2",
      owner: "OWNER2",
      device_type: "weather",
      lat: 30,
      lon: 40,
      registered_at: 2000,
    });
    repo.insertReading(db, {
      device_address: "DEV2",
      device_type: "weather",
      region_code: 42,
      epoch: 7,
      value: 3000,
      accepted: 1,
      ledger: 102,
      closed_at: "2026-01-01T00:02:00Z",
      tx_hash: "TX3",
    });
    const res = await request(app).get("/readings?region=42&epoch=7");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    // Results should be ordered by ledger DESC — DEV2 (ledger 102) first
    expect(res.body[0].device_address).toBe("DEV2");
    expect(res.body[1].device_address).toBe("DEV1");
  });

  it("GET /readings 400s when region param is missing", async () => {
    const res = await request(app).get("/readings?epoch=7");
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("GET /readings 400s when epoch param is missing", async () => {
    const res = await request(app).get("/readings?region=42");
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("GET /readings 400s when region param is not a number", async () => {
    const res = await request(app).get("/readings?region=abc&epoch=7");
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("GET /readings 400s when epoch param is not a number", async () => {
    const res = await request(app).get("/readings?region=42&epoch=not-a-number");
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("GET /readings 400s when both params are missing", async () => {
    const res = await request(app).get("/readings");
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("GET /readings does not return readings from a different epoch", async () => {
    repo.insertReading(db, {
      device_address: "DEV1",
      device_type: "weather",
      region_code: 42,
      epoch: 8, // different epoch
      value: 9999,
      accepted: 1,
      ledger: 200,
      closed_at: "2026-02-01T00:00:00Z",
      tx_hash: "TX_EPOCH8",
    });
    const res = await request(app).get("/readings?region=42&epoch=7");
    expect(res.status).toBe(200);
    expect(res.body.every((r: { epoch: number }) => r.epoch === 7)).toBe(true);
  });

  it("GET /readings does not return readings from a different region", async () => {
    repo.insertReading(db, {
      device_address: "DEV1",
      device_type: "weather",
      region_code: 99, // different region
      epoch: 7,
      value: 8888,
      accepted: 1,
      ledger: 201,
      closed_at: "2026-02-01T00:01:00Z",
      tx_hash: "TX_REGION99",
    });
    const res = await request(app).get("/readings?region=42&epoch=7");
    expect(res.status).toBe(200);
    expect(res.body.every((r: { region_code: number }) => r.region_code === 42)).toBe(true);
  });

  it("GET /readings includes rejected (accepted=0) readings in results", async () => {
    // Unlike regionAverage which only includes accepted=1, the raw listing
    // returns all readings regardless of accepted status.
    repo.insertReading(db, {
      device_address: "DEV1",
      device_type: "weather",
      region_code: 42,
      epoch: 7,
      value: 100,
      accepted: 0, // rejected reading
      ledger: 103,
      closed_at: "2026-01-01T00:03:00Z",
      tx_hash: "TX_REJECTED",
    });
    const res = await request(app).get("/readings?region=42&epoch=7");
    expect(res.status).toBe(200);
    // Should include both the accepted and the rejected reading
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    const accepted = res.body.filter((r: { accepted: number }) => r.accepted === 1);
    const rejected = res.body.filter((r: { accepted: number }) => r.accepted === 0);
    expect(accepted.length).toBeGreaterThanOrEqual(1);
    expect(rejected.length).toBe(1);
  });

  // ── Error-handling middleware ──────────────────────────────────────────────

  it("error-handling middleware returns JSON on unhandled route errors", async () => {
    // Force a real route handler to throw — querying a closed database —
    // rather than appending a new route after `app` is already built.
    // Express only forwards next(err) to error-handling middleware
    // registered *after* the throwing handler in the stack; a route added
    // post-hoc here would land after createApp's error handler and never
    // reach it, so this instead exercises the handler in its real,
    // already-correct position.
    db.close();
    const res = await request(app).get("/devices");
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty("error");
    expect(typeof res.body.error).toBe("string");
  });

  // ── Pagination: GET /devices ───────────────────────────────────────────────

  describe("GET /devices pagination", () => {
    beforeEach(() => {
      // Seed 5 more devices (DEV1 already exists from the outer beforeEach,
      // total will be 6 devices)
      for (let i = 2; i <= 6; i++) {
        repo.upsertDevice(db, {
          address: `DEV${i}`,
          owner: `OWNER${i}`,
          device_type: "weather",
          lat: i * 10,
          lon: i * 10,
          registered_at: 1000 + i,
        });
      }
    });

    it("returns a paginated envelope with data/total/limit/offset fields", async () => {
      const res = await request(app).get("/devices");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("data");
      expect(res.body).toHaveProperty("total");
      expect(res.body).toHaveProperty("limit");
      expect(res.body).toHaveProperty("offset");
    });

    it("offset=0 is equivalent to omitting offset", async () => {
      const withZero    = await request(app).get("/devices?offset=0");
      const withDefault = await request(app).get("/devices");
      expect(withZero.status).toBe(200);
      expect(withDefault.status).toBe(200);
      expect(withZero.body.data).toEqual(withDefault.body.data);
      expect(withZero.body.offset).toBe(0);
      expect(withDefault.body.offset).toBe(0);
    });
    it("total reflects full count regardless of limit", async () => {
      const res = await request(app).get("/devices?limit=2");
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(6);
      expect(res.body.data).toHaveLength(2);
    });

    it("applies default limit of 50 when no limit is supplied", async () => {
      const res = await request(app).get("/devices");
      expect(res.status).toBe(200);
      expect(res.body.limit).toBe(50);
    });

    it("explicit limit is respected", async () => {
      const res = await request(app).get("/devices?limit=3");
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
      expect(res.body.limit).toBe(3);
    });

    it("response is ordered by registered_at descending", async () => {
      // With a full first page, the first item must be the most-recently
      // registered device (highest registered_at). DEV6 was seeded with
      // registered_at = 1006, the highest in this test corpus.
      const res = await request(app).get("/devices?limit=6");
      expect(res.status).toBe(200);
      expect(res.body.data[0].address).toBe("DEV6");
    });

    it("offset skips the correct number of rows", async () => {
      // Get first page
      const page1 = await request(app).get("/devices?limit=2&offset=0");
      // Get second page
      const page2 = await request(app).get("/devices?limit=2&offset=2");
      expect(page1.status).toBe(200);
      expect(page2.status).toBe(200);
      // Pages must not overlap
      const page1Addrs = page1.body.data.map((d: { address: string }) => d.address);
      const page2Addrs = page2.body.data.map((d: { address: string }) => d.address);
      const overlap = page1Addrs.filter((a: string) => page2Addrs.includes(a));
      expect(overlap).toHaveLength(0);
    });

    it("three pages cover the full dataset without gaps or duplicates", async () => {
      // 6 devices, 3 pages of 2 each — union should equal the full 6
      const page1 = await request(app).get("/devices?limit=2&offset=0");
      const page2 = await request(app).get("/devices?limit=2&offset=2");
      const page3 = await request(app).get("/devices?limit=2&offset=4");
      const allAddrs = [
        ...page1.body.data,
        ...page2.body.data,
        ...page3.body.data,
      ].map((d: { address: string }) => d.address);
      // All 6 devices present, no duplicates
      expect(new Set(allAddrs).size).toBe(6);
    });

    it("offset beyond total returns empty data array", async () => {
      const res = await request(app).get("/devices?offset=9999");
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
      expect(res.body.total).toBe(6);
    });

    it("clamps limit to MAX_LIMIT (500)", async () => {
      const res = await request(app).get("/devices?limit=99999");
      expect(res.status).toBe(200);
      expect(res.body.limit).toBe(500);
    });

    it("400s when limit is negative", async () => {
      const res = await request(app).get("/devices?limit=-1");
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
    });

    it("400s when limit is non-numeric", async () => {
      const res = await request(app).get("/devices?limit=abc");
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
    });

    it("limit=0 returns empty data with correct total", async () => {
      const res = await request(app).get("/devices?limit=0");
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
      expect(res.body.total).toBe(6);
      expect(res.body.limit).toBe(0);
    });

    it("400s when offset is negative", async () => {
      const res = await request(app).get("/devices?offset=-5");
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
    });

    it("both limit and offset can be combined correctly", async () => {
      // Using limit=2 offset=1: should skip 1 (DEV6), return DEV5 and DEV4
      const res = await request(app).get("/devices?limit=2&offset=1");
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      // First item should be DEV5 (registered_at 1005, second newest)
      expect(res.body.data[0].address).toBe("DEV5");
    });

    it("400s when offset is non-numeric", async () => {
      const res = await request(app).get("/devices?offset=xyz");
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
    });
  });

  // ── Pagination: GET /devices/:address/readings ─────────────────────────────

  describe("GET /devices/:address/readings pagination", () => {
    beforeEach(() => {
      // Seed 5 more readings for DEV1 (1 already exists, total will be 6)
      for (let i = 2; i <= 6; i++) {
        repo.insertReading(db, {
          device_address: "DEV1",
          device_type: "weather",
          region_code: 42,
          epoch: i,
          value: 1000 + i,
          accepted: 1,
          ledger: 100 + i,
          closed_at: "2026-01-01T00:00:00Z",
          tx_hash: `TX_READ_${i}`,
        });
      }
    });

    it("returns a paginated envelope with data/total/limit/offset fields", async () => {
      const res = await request(app).get("/devices/DEV1/readings");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("data");
      expect(res.body).toHaveProperty("total");
      expect(res.body).toHaveProperty("limit");
      expect(res.body).toHaveProperty("offset");
    });

    it("offset=0 is equivalent to omitting offset", async () => {
      const withZero    = await request(app).get("/devices/DEV1/readings?offset=0");
      const withDefault = await request(app).get("/devices/DEV1/readings");
      expect(withZero.status).toBe(200);
      expect(withDefault.status).toBe(200);
      expect(withZero.body.data).toEqual(withDefault.body.data);
      expect(withZero.body.offset).toBe(0);
      expect(withDefault.body.offset).toBe(0);
    });
    it("total reflects full count regardless of limit", async () => {
      const res = await request(app).get("/devices/DEV1/readings?limit=2");
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(6);
      expect(res.body.data).toHaveLength(2);
    });

    it("applies default limit of 50 when no limit is supplied", async () => {
      const res = await request(app).get("/devices/DEV1/readings");
      expect(res.status).toBe(200);
      expect(res.body.limit).toBe(50);
    });

    it("explicit limit is respected", async () => {
      const res = await request(app).get("/devices/DEV1/readings?limit=3");
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
      expect(res.body.limit).toBe(3);
    });

    it("response is ordered by ledger descending", async () => {
      // The reading with the highest ledger (ledger=106, epoch=6) must come first.
      const res = await request(app).get("/devices/DEV1/readings?limit=6");
      expect(res.status).toBe(200);
      // Ledger values seeded: 100 (original), 102-106 (seeded in beforeEach)
      // Highest is 106 → this reading must be first
      expect(res.body.data[0].ledger).toBe(106);
    });

    it("offset skips the correct number of rows", async () => {
      const page1 = await request(app).get("/devices/DEV1/readings?limit=2&offset=0");
      const page2 = await request(app).get("/devices/DEV1/readings?limit=2&offset=2");
      expect(page1.status).toBe(200);
      expect(page2.status).toBe(200);
      const page1Ids = page1.body.data.map((r: { id: number }) => r.id);
      const page2Ids = page2.body.data.map((r: { id: number }) => r.id);
      const overlap = page1Ids.filter((id: number) => page2Ids.includes(id));
      expect(overlap).toHaveLength(0);
    });

    it("three pages cover all readings without gaps or duplicates", async () => {
      const page1 = await request(app).get("/devices/DEV1/readings?limit=2&offset=0");
      const page2 = await request(app).get("/devices/DEV1/readings?limit=2&offset=2");
      const page3 = await request(app).get("/devices/DEV1/readings?limit=2&offset=4");
      const allIds = [
        ...page1.body.data,
        ...page2.body.data,
        ...page3.body.data,
      ].map((r: { id: number }) => r.id);
      expect(new Set(allIds).size).toBe(6);
    });

    it("offset beyond total returns empty data array", async () => {
      const res = await request(app).get("/devices/DEV1/readings?offset=9999");
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
      expect(res.body.total).toBe(6);
    });

    it("clamps limit to MAX_LIMIT (500)", async () => {
      const res = await request(app).get("/devices/DEV1/readings?limit=99999");
      expect(res.status).toBe(200);
      expect(res.body.limit).toBe(500);
    });

    it("400s when limit is negative", async () => {
      const res = await request(app).get("/devices/DEV1/readings?limit=-1");
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
    });

    it("400s when limit is non-numeric", async () => {
      const res = await request(app).get("/devices/DEV1/readings?limit=bad");
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
    });

    it("limit=0 returns empty data with correct total", async () => {
      const res = await request(app).get("/devices/DEV1/readings?limit=0");
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
      expect(res.body.total).toBe(6);
      expect(res.body.limit).toBe(0);
    });

    it("400s when offset is negative", async () => {
      const res = await request(app).get("/devices/DEV1/readings?offset=-3");
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
    });

    it("both limit and offset can be combined correctly", async () => {
      // Readings ordered by ledger DESC: 106, 105, 104, 103, 102, 100
      // offset=1 skips ledger 106; limit=2 returns 105 and 104
      const res = await request(app).get("/devices/DEV1/readings?limit=2&offset=1");
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].ledger).toBe(105);
      expect(res.body.data[1].ledger).toBe(104);
    });

    it("400s when offset is non-numeric", async () => {
      const res = await request(app).get("/devices/DEV1/readings?offset=bad");
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
    });

    it("returns only readings belonging to the specified device", async () => {
      // Seed a second device with its own reading
      repo.upsertDevice(db, {
        address: "DEV_OTHER",
        owner: "OWNER_OTHER",
        device_type: "weather",
        lat: 99,
        lon: 99,
        registered_at: 9000,
      });
      repo.insertReading(db, {
        device_address: "DEV_OTHER",
        device_type: "weather",
        region_code: 1,
        epoch: 1,
        value: 9999,
        accepted: 1,
        ledger: 999,
        closed_at: "2026-06-01T00:00:00Z",
        tx_hash: "TX_OTHER_DEVICE",
      });
      const res = await request(app).get("/devices/DEV1/readings?limit=100");
      expect(res.status).toBe(200);
      // All returned readings must belong to DEV1, not DEV_OTHER
      expect(
        res.body.data.every(
          (r: { device_address: string }) => r.device_address === "DEV1",
        ),
      ).toBe(true);
      // total must not include DEV_OTHER's reading
      expect(res.body.total).toBe(6);
    });
  });
});
