import { loadConfig, configuredContractIds } from "./config.js";
import { openDb } from "./db/client.js";
import { createApp } from "./api/app.js";
import { startPolling } from "./ingest/poller.js";

// This is a long-running service making outbound calls to Stellar RPC over
// the real internet — transient network blips (a reset connection, a DNS
// hiccup) are expected, not exceptional. Some of those surface as
// unhandled rejections from the underlying HTTP client's connection-pool
// internals rather than from our own awaited `fetchEvents`/`latestLedger`
// calls (which are already try/caught in poller.ts's `startPolling`), so
// they'd otherwise crash the whole process on something as mundane as one
// dropped TLS handshake. Log and keep running instead.
process.on("unhandledRejection", (reason) => {
  console.error("[index] unhandled rejection (continuing):", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[index] uncaught exception (continuing):", err);
});

const config = loadConfig();
const db = openDb(config.dbPath);

const watchedContracts = configuredContractIds(config);
let poller: ReturnType<typeof startPolling> | undefined;
if (watchedContracts.length === 0) {
  console.warn(
    "[index] no contract IDs configured — the API will serve an empty dataset until " +
      "DEVICE_REGISTRY_CONTRACT_ID etc. are set in .env. See .env.example.",
  );
} else {
  poller = startPolling({ db, config }, config.pollIntervalMs);
  console.log(`[index] polling ${watchedContracts.length} contract(s) every ${config.pollIntervalMs}ms`);
}

const app = createApp(db, config);
const server = app.listen(config.port, () => {
  console.log(`[index] API listening on :${config.port}`);
});

/**
 * A deploy restart or container stop sends SIGTERM (Ctrl-C sends SIGINT
 * locally). Without handling it, the process dies mid-write: a poll cycle
 * that's partway through an insert, or an HTTP response still being
 * written. Shut down in dependency order instead — stop taking new poll
 * cycles and new HTTP connections first, let whatever's already in flight
 * finish, then close the DB last, since both the poller and any in-flight
 * request may still touch it right up until they settle.
 */
let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[index] received ${signal}, shutting down gracefully...`);

  poller?.stop();
  const closeServer = new Promise<void>((resolve) => server.close(() => resolve()));

  await poller?.whenIdle();
  await closeServer;

  db.close();
  console.log("[index] shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", (signal) => void shutdown(signal));
process.on("SIGINT", (signal) => void shutdown(signal));
