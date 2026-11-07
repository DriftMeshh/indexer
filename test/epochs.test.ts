import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { openDb, type Db } from "../src/db/client.js";
import { createApp } from "../src/api/app.js";
import type { Config } from "../src/config.js";

const { isEpochFinalMock, getTotalSubmissionsMock, epochPoolMock } = vi.hoisted(() => ({
  isEpochFinalMock: vi.fn(),
  getTotalSubmissionsMock: vi.fn(),
  epochPoolMock: vi.fn(),
}));

vi.mock("submission-validator", () => ({
  Client: class {
    is_epoch_final = isEpochFinalMock;
    get_total_submissions = getTotalSubmissionsMock;
  },
}));

vi.mock("payment-streamer", () => ({
  Client: class {
    epoch_pool = epochPoolMock;
  },
}));

function baseConfig(): Config {
  return {
    rpcUrl: "https://rpc.example",
    networkPassphrase: "Test SDF Network ; September 2015",
    contracts: {
      deviceRegistry: "CREGISTRY",
      submissionValidator: "CVALIDATOR",
      paymentStreamer: "CSTREAMER",
      subscriptionMarket: "CMARKET",
    },
    dbPath: ":memory:",
    pollIntervalMs: 5000,
    port: 0,
  };
}

describe("GET /epochs/:epoch", () => {
  let db: Db;

  beforeEach(() => {
    db = openDb(":memory:");
    isEpochFinalMock.mockReset();
    getTotalSubmissionsMock.mockReset();
    epochPoolMock.mockReset();
  });

  it("returns live finality/totals/pool from the chain", async () => {
    isEpochFinalMock.mockResolvedValue({ result: true });
    getTotalSubmissionsMock.mockResolvedValue({ result: 57 });
    epochPoolMock.mockResolvedValue({ result: 10_000_000_000n });

    const app = createApp(db, baseConfig());
    const res = await request(app).get("/epochs/3");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      epoch: 3,
      isFinal: true,
      totalSubmissions: 57,
      epochPool: "10000000000",
    });
    expect(isEpochFinalMock).toHaveBeenCalledWith({ epoch: 3 });
  });

  it("400s on a non-numeric or negative epoch", async () => {
    const app = createApp(db, baseConfig());
    expect((await request(app).get("/epochs/abc")).status).toBe(400);
    expect((await request(app).get("/epochs/-1")).status).toBe(400);
  });

  it("503s when the contract read fails", async () => {
    isEpochFinalMock.mockRejectedValue(new Error("rpc down"));

    const app = createApp(db, baseConfig());
    const res = await request(app).get("/epochs/3");
    expect(res.status).toBe(503);
  });

  it("503s when createApp wasn't given a config", async () => {
    const app = createApp(db);
    const res = await request(app).get("/epochs/3");
    expect(res.status).toBe(503);
  });

  it("503s when a contract ID is missing from config", async () => {
    const config = baseConfig();
    config.contracts.paymentStreamer = undefined;
    const app = createApp(db, config);
    const res = await request(app).get("/epochs/3");
    expect(res.status).toBe(503);
  });
});
