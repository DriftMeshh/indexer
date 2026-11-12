import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Db } from "../src/db/client.js";
import { createTestDb, closeTestDb } from "./helpers/db.js";
import * as repo from "../src/db/repository.js";
import { createApp } from "../src/api/app.js";
import type { Config } from "../src/config.js";

const { fetchPayoutReadinessMock } = vi.hoisted(() => ({
  fetchPayoutReadinessMock: vi.fn(),
}));

vi.mock("../src/stellar/horizon.js", () => ({
  fetchPayoutReadiness: fetchPayoutReadinessMock,
}));

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
    rateLimit: { windowMs: 60_000, max: 1000 },
    apiKey: undefined,
    horizonUrl: "https://horizon.example",
    rewardAsset: { code: "DMU", issuer: "GISSUER" },
    ...overrides,
  };
}

describe("GET /devices/:address payoutReady", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
    await repo.upsertDevice(db, {
      address: "DEV1",
      owner: "OWNER1",
      device_type: "weather",
      lat: 10,
      lon: 20,
      registered_at: 1000,
    });
    fetchPayoutReadinessMock.mockReset();
  });

  afterEach(async () => {
    await closeTestDb(db);
  });

  it("omits payoutReady when createApp receives no config", async () => {
    const app = createApp(db);
    const res = await request(app).get("/devices/DEV1");
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("payoutReady");
    expect(fetchPayoutReadinessMock).not.toHaveBeenCalled();
  });

  it("omits payoutReady when config has no rewardAsset configured", async () => {
    const app = createApp(db, baseConfig({ rewardAsset: undefined }));
    const res = await request(app).get("/devices/DEV1");
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("payoutReady");
    expect(fetchPayoutReadinessMock).not.toHaveBeenCalled();
  });

  it("includes payoutReady: true when the device holds the trustline", async () => {
    fetchPayoutReadinessMock.mockResolvedValue(true);
    const app = createApp(db, baseConfig());
    const res = await request(app).get("/devices/DEV1");

    expect(res.status).toBe(200);
    expect(res.body.payoutReady).toBe(true);
    expect(fetchPayoutReadinessMock).toHaveBeenCalledWith(
      "https://horizon.example",
      "DEV1",
      { code: "DMU", issuer: "GISSUER" },
    );
  });

  it("includes payoutReady: false when the device doesn't hold the trustline", async () => {
    fetchPayoutReadinessMock.mockResolvedValue(false);
    const app = createApp(db, baseConfig());
    const res = await request(app).get("/devices/DEV1");
    expect(res.body.payoutReady).toBe(false);
  });

  it("includes payoutReady: null when the Horizon lookup itself fails", async () => {
    fetchPayoutReadinessMock.mockResolvedValue(null);
    const app = createApp(db, baseConfig());
    const res = await request(app).get("/devices/DEV1");
    expect(res.body.payoutReady).toBeNull();
  });

  it("still 404s for an unknown device without calling Horizon at all", async () => {
    const app = createApp(db, baseConfig());
    const res = await request(app).get("/devices/NOPE");
    expect(res.status).toBe(404);
    expect(fetchPayoutReadinessMock).not.toHaveBeenCalled();
  });
});
