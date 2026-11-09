export interface Config {
  rpcUrl: string;
  networkPassphrase: string;
  contracts: {
    deviceRegistry: string | undefined;
    submissionValidator: string | undefined;
    paymentStreamer: string | undefined;
    subscriptionMarket: string | undefined;
  };
  databaseUrl: string;
  pollIntervalMs: number;
  port: number;
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
    databaseUrl:
      env.DATABASE_URL ?? "postgresql://driftmesh:driftmesh@127.0.0.1:5432/driftmesh",
    pollIntervalMs: Number(env.POLL_INTERVAL_MS ?? 5000),
    // PORT is the common convention (Render, Railway); SERVER_PORT is
    // Bot-Hosting.net's — support whichever the host injects.
    port: Number(env.PORT ?? env.SERVER_PORT ?? 3001),
  };
}

/** The subset of contract IDs that are actually configured, for the poller to watch. */
export function configuredContractIds(config: Config): string[] {
  return Object.values(config.contracts).filter((id): id is string => Boolean(id));
}
