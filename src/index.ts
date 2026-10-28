import { loadConfig, configuredContractIds } from "./config.js";
import { openDb } from "./db/client.js";
import { createApp } from "./api/app.js";
import { startPolling } from "./ingest/poller.js";

const config = loadConfig();
const db = openDb(config.dbPath);

const watchedContracts = configuredContractIds(config);
if (watchedContracts.length === 0) {
  console.warn(
    "[index] no contract IDs configured — the API will serve an empty dataset until " +
      "DEVICE_REGISTRY_CONTRACT_ID etc. are set in .env. See .env.example.",
  );
} else {
  startPolling({ db, config }, config.pollIntervalMs);
  console.log(`[index] polling ${watchedContracts.length} contract(s) every ${config.pollIntervalMs}ms`);
}

const app = createApp(db);
app.listen(config.port, () => {
  console.log(`[index] API listening on :${config.port}`);
});
