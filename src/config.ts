export interface Config {
  rpcUrl: string;
  networkPassphrase: string;
  contracts: {
    deviceRegistry: string | undefined;
    submissionValidator: string | undefined;
    paymentStreamer: string | undefined;
    subscriptionMarket: string | undefined;
  };
  dbPath: string;
  pollIntervalMs: number;
  port: number;
  rateLimit: {
    windowMs: number;
    max: number;
  };
  /** When set, every request must carry this value in X-API-Key. Unset (the default) means no auth — fine for local/demo use. */
  apiKey: string | undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    rpcUrl: env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org",
    networkPassphrase: env.NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015",
    contracts: {
      deviceRegistry: env.DEVICE_REGISTRY_CONTRACT_ID,
      submissionValidator: env.SUBMISSION_VALIDATOR_CONTRACT_ID,
      paymentStreamer: env.PAYMENT_STREAMER_CONTRACT_ID,
      subscriptionMarket: env.SUBSCRIPTION_MARKET_CONTRACT_ID,
    },
    dbPath: env.DB_PATH ?? "./data/driftmesh.sqlite",
    pollIntervalMs: Number(env.POLL_INTERVAL_MS ?? 5000),
    // PORT is the common convention (Render, Railway); SERVER_PORT is
    // Bot-Hosting.net's — support whichever the host injects.
    port: Number(env.PORT ?? env.SERVER_PORT ?? 3001),
    rateLimit: {
      // 100 requests/minute per IP is generous for a single frontend's
      // normal polling traffic while still bounding a runaway/abusive
      // client — tune via env vars for a specific deployment's needs.
      windowMs: Number(env.RATE_LIMIT_WINDOW_MS ?? 60_000),
      max: Number(env.RATE_LIMIT_MAX ?? 100),
    },
    apiKey: env.API_KEY,
  };
}

/** The subset of contract IDs that are actually configured, for the poller to watch. */
export function configuredContractIds(config: Config): string[] {
  return Object.values(config.contracts).filter((id): id is string => Boolean(id));
}
