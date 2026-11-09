import { logger, serializeError } from "../logger.js";

interface HorizonBalance {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
}

interface HorizonAccountResponse {
  balances: HorizonBalance[];
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { value: boolean; expiresAt: number }>();

/** Test-only — avoids one test's cached result leaking into another's assertions. */
export function clearPayoutReadyCache(): void {
  cache.clear();
}

/**
 * Whether `address` currently holds a trustline to `rewardAsset` — the
 * prerequisite discovered the hard way during manual testnet verification:
 * a classic-Stellar account can't receive a transfer of a SAC-wrapped
 * classic asset (like this project's DMU) without first trusting it, and
 * the resulting contract error gives no hint that a trustline is the fix.
 *
 * Queries Horizon directly (not Soroban RPC — trustlines are classic
 * account state, which RPC doesn't expose) and caches the result briefly
 * per address so a frontend polling a device detail page doesn't hammer
 * Horizon on every refresh. Returns null on a lookup failure (an
 * unknown/unfunded account, a network error) — "not ready" and "unknown"
 * are different things, and the caller (routes/devices.ts) represents
 * that distinction in the response rather than collapsing both to false.
 */
export async function fetchPayoutReadiness(
  horizonUrl: string,
  address: string,
  rewardAsset: { code: string; issuer: string },
): Promise<boolean | null> {
  const cacheKey = `${address}:${rewardAsset.code}:${rewardAsset.issuer}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  try {
    const res = await fetch(`${horizonUrl}/accounts/${address}`);
    if (!res.ok) {
      // A 404 (account never funded/created) is a legitimate "not ready"
      // answer, not a failure — distinguish it from a real lookup error.
      if (res.status === 404) {
        cache.set(cacheKey, { value: false, expiresAt: Date.now() + CACHE_TTL_MS });
        return false;
      }
      logger.warn("horizon", "account lookup returned non-OK status", {
        address,
        status: res.status,
      });
      return null;
    }

    const account = (await res.json()) as HorizonAccountResponse;
    const trusts = account.balances.some(
      (b) => b.asset_code === rewardAsset.code && b.asset_issuer === rewardAsset.issuer,
    );
    cache.set(cacheKey, { value: trusts, expiresAt: Date.now() + CACHE_TTL_MS });
    return trusts;
  } catch (err) {
    logger.warn("horizon", "account lookup failed", { address, ...serializeError(err) });
    return null;
  }
}
