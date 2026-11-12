import { beforeEach, afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Db } from "../src/db/client.js";
import { createTestDb, closeTestDb } from "./helpers/db.js";
import { createApp } from "../src/api/app.js";
import type { Config } from "../src/config.js";

function baseConfig(overrides?: Partial<Config>): Config {
  return {
    rpcUrl: "https://rpc.example",
    networkPassphrase: "Test SDF Network ; September 2015",
    contracts: {
      deviceRegistry: undefined,
      submissionValidator: undefined,
      paymentStreamer: undefined,
      subscriptionMarket: undefined,
    },
    dbPath: ":memory:",
    pollIntervalMs: 5000,
    port: 0,
    rateLimit: { windowMs: 60_000, max: 2 },
    apiKey: undefined,
    horizonUrl: "https://horizon.example",
    rewardAsset: undefined,
    ...overrides,
  };
}

describe("rate limiting", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await closeTestDb(db);
  });

  it("does not rate-limit at all when createApp receives no config", async () => {
    const app = createApp(db);
    for (let i = 0; i < 5; i++) {
      const res = await request(app).get("/devices");
      expect(res.status).toBe(200);
    }
  });

  it("allows requests up to the configured max, then 429s", async () => {
    const app = createApp(db, baseConfig({ rateLimit: { windowMs: 60_000, max: 2 } }));

    expect((await request(app).get("/devices")).status).toBe(200);
    expect((await request(app).get("/devices")).status).toBe(200);
    const third = await request(app).get("/devices");
    expect(third.status).toBe(429);
    expect(third.body).toEqual({ error: "too many requests, try again later" });
  });

  it("never rate-limits GET /health, even past the configured max", async () => {
    const app = createApp(db, baseConfig({ rateLimit: { windowMs: 60_000, max: 1 } }));

    for (let i = 0; i < 5; i++) {
      const res = await request(app).get("/health");
      expect(res.status).toBe(200);
    }
  });

  it("sets standard RateLimit-* response headers", async () => {
    const app = createApp(db, baseConfig({ rateLimit: { windowMs: 60_000, max: 2 } }));
    const res = await request(app).get("/devices");
    expect(res.headers).toHaveProperty("ratelimit-limit");
    expect(res.headers).toHaveProperty("ratelimit-remaining");
  });
});

describe("X-API-Key auth", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await closeTestDb(db);
  });

  it("is not enforced when createApp receives no config", async () => {
    const app = createApp(db);
    const res = await request(app).get("/devices");
    expect(res.status).toBe(200);
  });

  it("is not enforced when config.apiKey is unset", async () => {
    const app = createApp(db, baseConfig({ apiKey: undefined }));
    const res = await request(app).get("/devices");
    expect(res.status).toBe(200);
  });

  it("401s a request with no X-API-Key header when one is configured", async () => {
    const app = createApp(db, baseConfig({ apiKey: "secret123" }));
    const res = await request(app).get("/devices");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "missing or invalid X-API-Key" });
  });

  it("401s a request with the wrong X-API-Key", async () => {
    const app = createApp(db, baseConfig({ apiKey: "secret123" }));
    const res = await request(app).get("/devices").set("X-API-Key", "wrong");
    expect(res.status).toBe(401);
  });

  it("200s a request with the correct X-API-Key", async () => {
    const app = createApp(db, baseConfig({ apiKey: "secret123" }));
    const res = await request(app).get("/devices").set("X-API-Key", "secret123");
    expect(res.status).toBe(200);
  });

  it("never requires X-API-Key for GET /health", async () => {
    const app = createApp(db, baseConfig({ apiKey: "secret123" }));
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
  });
});
