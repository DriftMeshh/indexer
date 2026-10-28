export interface Config {
  rpcUrl: string;
  contracts: {
    deviceRegistry: string | undefined;
    submissionValidator: string | undefined;
    paymentStreamer: string | undefined;
    subscriptionMarket: string | undefined;
  };
  dbPath: string;
  pollIntervalMs: number;
  port: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    rpcUrl: env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org",
    contracts: {
      deviceRegistry: env.DEVICE_REGISTRY_CONTRACT_ID,
      submissionValidator: env.SUBMISSION_VALIDATOR_CONTRACT_ID,
      paymentStreamer: env.PAYMENT_STREAMER_CONTRACT_ID,
      subscriptionMarket: env.SUBSCRIPTION_MARKET_CONTRACT_ID,
    },
    dbPath: env.DB_PATH ?? "./data/driftmesh.sqlite",
    pollIntervalMs: Number(env.POLL_INTERVAL_MS ?? 5000),
    port: Number(env.PORT ?? 3001),
  };
}

/** The subset of contract IDs that are actually configured, for the poller to watch. */
export function configuredContractIds(config: Config): string[] {
  return Object.values(config.contracts).filter((id): id is string => Boolean(id));
}
