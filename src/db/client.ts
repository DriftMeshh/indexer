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
  active INTEGER NOT NULL DEFAULT 1,
  -- Denormalized from the disputes table (same pattern as "active") so
  -- GET /devices can surface them without a join per row.
  open_disputes INTEGER NOT NULL DEFAULT 0,
  upheld_disputes INTEGER NOT NULL DEFAULT 0
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

-- One row per raise_dispute call. device-registry only allows one open
-- dispute per device at a time, so the later dispute_resolved event (which
-- carries no dispute ID of its own) is matched to whichever row for that
-- device_address is still status='open' — see repository.ts's resolveDispute.
CREATE TABLE IF NOT EXISTS disputes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_address TEXT NOT NULL,
  disputer TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', -- 'open' | 'upheld' | 'dismissed'
  raised_ledger INTEGER NOT NULL,
  raised_closed_at TEXT NOT NULL,
  raised_tx_hash TEXT NOT NULL,
  resolved_ledger INTEGER,
  resolved_closed_at TEXT,
  resolved_tx_hash TEXT,
  UNIQUE(raised_tx_hash, device_address)
);
CREATE INDEX IF NOT EXISTS idx_disputes_device ON disputes(device_address);

CREATE TABLE IF NOT EXISTS auto_slash_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_address TEXT NOT NULL,
  rejected_count INTEGER NOT NULL,
  threshold INTEGER NOT NULL,
  ledger INTEGER NOT NULL,
  closed_at TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  UNIQUE(tx_hash, device_address)
);
CREATE INDEX IF NOT EXISTS idx_auto_slash_device ON auto_slash_events(device_address);
`;

export type Db = Database.Database;

/**
 * Adds a column to an existing table if it isn't there yet. `CREATE TABLE
 * IF NOT EXISTS` only helps on a brand-new database — an existing
 * `devices` table from before `open_disputes`/`upheld_disputes` existed
 * needs this instead. There's no real migration tool here (see the
 * README's known limitations); this is the lightweight stand-in for it.
 */
function ensureColumn(db: Database.Database, table: string, column: string, definition: string): void {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!existing.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/** Opens (and migrates) the SQLite database at `path`. Pass ":memory:" for tests. */
export function openDb(path: string): Db {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  ensureColumn(db, "devices", "open_disputes", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "devices", "upheld_disputes", "INTEGER NOT NULL DEFAULT 0");
  return db;
}
