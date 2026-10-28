import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SCHEMA = `
-- owner/lat/lon are nullable: the "reg_dev" event only carries device_type,
-- not the rest of the Device record (see README's "Known limitations" —
-- a Wave issue to either enrich the event or have the poller read the
-- full record via a contract call is left open).
CREATE TABLE IF NOT EXISTS devices (
  address TEXT PRIMARY KEY,
  owner TEXT,
  device_type TEXT NOT NULL,
  lat INTEGER,
  lon INTEGER,
  registered_at INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_address TEXT NOT NULL,
  device_type TEXT,
  region_code INTEGER NOT NULL,
  epoch INTEGER NOT NULL,
  value INTEGER NOT NULL,
  accepted INTEGER NOT NULL,
  ledger INTEGER NOT NULL,
  closed_at TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  UNIQUE(tx_hash, device_address)
);
CREATE INDEX IF NOT EXISTS idx_readings_device ON readings(device_address);
CREATE INDEX IF NOT EXISTS idx_readings_region_epoch ON readings(region_code, epoch);

CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_address TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  payout TEXT NOT NULL,
  ledger INTEGER NOT NULL,
  closed_at TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  UNIQUE(device_address, epoch)
);
CREATE INDEX IF NOT EXISTS idx_claims_device ON claims(device_address);

CREATE TABLE IF NOT EXISTS subscriptions (
  subscriber TEXT PRIMARY KEY,
  periods_last_purchase INTEGER NOT NULL,
  expiry INTEGER NOT NULL,
  updated_at_ledger INTEGER NOT NULL
);

-- One row per watched contract, tracking how far the poller has ingested.
CREATE TABLE IF NOT EXISTS ingest_cursor (
  contract_id TEXT PRIMARY KEY,
  last_ledger INTEGER NOT NULL
);
`;

export type Db = Database.Database;

/** Opens (and migrates) the SQLite database at `path`. Pass ":memory:" for tests. */
export function openDb(path: string): Db {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
}
