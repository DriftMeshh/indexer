import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearPayoutReadyCache, fetchPayoutReadiness } from "../src/stellar/horizon.js";

const rewardAsset = { code: "DMU", issuer: "GISSUER" };

function mockFetchOnce(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }),
  );
}

describe("fetchPayoutReadiness", () => {
  beforeEach(() => {
    clearPayoutReadyCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns true when the account's balances include the reward asset", async () => {
    mockFetchOnce(200, {
      balances: [
        { asset_type: "native" },
        { asset_type: "credit_alphanum4", asset_code: "DMU", asset_issuer: "GISSUER" },
      ],
    });

    const ready = await fetchPayoutReadiness("https://horizon.example", "GDEVICE", rewardAsset);
    expect(ready).toBe(true);
  });

  it("returns false when the account exists but doesn't trust the reward asset", async () => {
    mockFetchOnce(200, { balances: [{ asset_type: "native" }] });

    const ready = await fetchPayoutReadiness("https://horizon.example", "GDEVICE", rewardAsset);
    expect(ready).toBe(false);
  });

  it("distinguishes the issuer, not just the asset code", async () => {
    mockFetchOnce(200, {
      balances: [
        { asset_type: "credit_alphanum4", asset_code: "DMU", asset_issuer: "GDIFFERENT" },
      ],
    });

    const ready = await fetchPayoutReadiness("https://horizon.example", "GDEVICE", rewardAsset);
    expect(ready).toBe(false);
  });

  it("returns false (not null) for a 404 — an unfunded account is a legitimate not-ready answer", async () => {
    mockFetchOnce(404, {});
    const ready = await fetchPayoutReadiness("https://horizon.example", "GDEVICE", rewardAsset);
    expect(ready).toBe(false);
  });

  it("returns null for a non-404 error status", async () => {
    mockFetchOnce(500, {});
    const ready = await fetchPayoutReadiness("https://horizon.example", "GDEVICE", rewardAsset);
    expect(ready).toBeNull();
  });

  it("returns null when the fetch itself throws (network error)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const ready = await fetchPayoutReadiness("https://horizon.example", "GDEVICE", rewardAsset);
    expect(ready).toBeNull();
  });

  it("caches a result and doesn't re-fetch within the TTL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ balances: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchPayoutReadiness("https://horizon.example", "GDEVICE", rewardAsset);
    await fetchPayoutReadiness("https://horizon.example", "GDEVICE", rewardAsset);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("caches per address — a different address still triggers its own fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ balances: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchPayoutReadiness("https://horizon.example", "GDEVICE1", rewardAsset);
    await fetchPayoutReadiness("https://horizon.example", "GDEVICE2", rewardAsset);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
