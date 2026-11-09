import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { openDb, type Db } from "../src/db/client.js";
import * as repo from "../src/db/repository.js";
import { createApp } from "../src/api/app.js";
import type { Config } from "../src/config.js";
import type { PollerMetrics } from "../src/ingest/poller.js";

const { latestLedgerMock } = vi.hoisted(() => ({ latestLedgerMock: vi.fn() }));

vi.mock("../src/stellar/rpc.js", () => ({ latestLedger: latestLedgerMock }));

function baseConfig(): Config {
  return {
    rpcUrl: "https://rpc.example",
    networkPassphrase: "Test SDF Network ; September 2015",
    contracts: {
      deviceRegistry: "CREGISTRY",
      submissionValidator: "CVALIDATOR",
      paymentStreamer: undefined,
      subscriptionMarket: undefined,
    },
    dbPath: ":memory:",
    pollIntervalMs: 5000,
    port: 0,
    // Generous enough that this file's handful of requests per test never
    // trips the limiter — rate limiting itself has its own test file.
    rateLimit: { windowMs: 60_000, max: 1000 },
    apiKey: undefined,
    horizonUrl: "https://horizon.example",
    rewardAsset: undefined,
  };
}

describe("GET /metrics", () => {
  let db: Db;

  beforeEach(() => {
    db = openDb(":memory:");
    latestLedgerMock.mockReset();
  });

  it("returns Prometheus text exposition format with Content-Type text/plain", async () => {
    const app = createApp(db);
    const res = await request(app).get("/metrics");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/plain/);
  });

  it("reports zeroed poller gauges when no getPollerMetrics callback is supplied", async () => {
    const app = createApp(db);
    const res = await request(app).get("/metrics");
    expect(res.text).toContain("driftmesh_indexer_last_successful_poll_timestamp_seconds 0");
    expect(res.text).toContain("driftmesh_indexer_consecutive_poll_failures 0");
    expect(res.text).toContain("driftmesh_indexer_last_cycle_events_ingested 0");
  });

  it("reports real poller metrics when a getPollerMetrics callback is supplied", async () => {
    const metrics: PollerMetrics = {
      lastSuccessfulPollAt: 1_700_000_000_000,
      consecutiveFailures: 2,
      lastCycleEventsIngested: 7,
    };
    const app = createApp(db, undefined, () => metrics);
    const res = await request(app).get("/metrics");

    expect(res.text).toContain("driftmesh_indexer_last_successful_poll_timestamp_seconds 1700000000");
    expect(res.text).toContain("driftmesh_indexer_consecutive_poll_failures 2");
    expect(res.text).toContain("driftmesh_indexer_last_cycle_events_ingested 7");
  });

  it("omits ledger_lag gauges entirely when no config is supplied", async () => {
    const app = createApp(db);
    const res = await request(app).get("/metrics");
    expect(res.text).not.toContain("driftmesh_indexer_ledger_lag");
    expect(latestLedgerMock).not.toHaveBeenCalled();
  });

  it("reports ledger_lag per configured contract as chain tip minus stored cursor", async () => {
    latestLedgerMock.mockResolvedValue(5100);
    repo.setCursor(db, "CREGISTRY", 5000);
    repo.setCursor(db, "CVALIDATOR", 5080);

    const app = createApp(db, baseConfig());
    const res = await request(app).get("/metrics");

    expect(res.text).toContain('driftmesh_indexer_ledger_lag{contract="device_registry"} 100');
    expect(res.text).toContain('driftmesh_indexer_ledger_lag{contract="submission_validator"} 20');
    // Unconfigured contracts (paymentStreamer/subscriptionMarket are
    // undefined in baseConfig) get no line at all.
    expect(res.text).not.toContain('contract="payment_streamer"');
  });

  it("reports a lag of 0 for a contract that's never been polled (cursor 0), not tip-minus-0", async () => {
    latestLedgerMock.mockResolvedValue(5100);
    // No setCursor call — getCursor(db, "CREGISTRY") returns 0 by default.

    const app = createApp(db, baseConfig());
    const res = await request(app).get("/metrics");

    expect(res.text).toContain('driftmesh_indexer_ledger_lag{contract="device_registry"} 0');
  });

  it("omits ledger_lag gauges (without erroring the whole response) when the RPC read fails", async () => {
    latestLedgerMock.mockRejectedValue(new Error("rpc down"));

    const app = createApp(db, baseConfig());
    const res = await request(app).get("/metrics");

    expect(res.status).toBe(200);
    expect(res.text).not.toContain("driftmesh_indexer_ledger_lag{");
    // The other gauges are still present — one failing section doesn't
    // take down the rest of the scrape.
    expect(res.text).toContain("driftmesh_indexer_consecutive_poll_failures");
  });
});
