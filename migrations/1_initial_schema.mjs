/**
 * Migration 1: Initial schema — ports the inline SQLite `CREATE TABLE IF NOT
 * EXISTS` block from the old `src/db/client.ts` to Postgres-compatible DDL.
 *
 * Key differences from the SQLite schema:
 *  - SERIAL PRIMARY KEY replaces `INTEGER PRIMARY KEY AUTOINCREMENT`
 *  - TEXT stays TEXT (Postgres has no separate CLOB; TEXT is unlimited)
 *  - INTEGER stays INTEGER (Postgres uses 32-bit int for INTEGER, 64-bit for BIGINT;
 *    all stored values here fit comfortably in 32-bit)
 *  - `active` and `accepted` stay INTEGER (0/1) for compatibility with the
 *    existing TypeScript row types — avoids a type-system ripple effect
 *  - `ON CONFLICT` syntax is identical between SQLite and Postgres
 *  - The inline `ensureColumn` migration guard from the SQLite client is
 *    replaced by this migration tool; `open_disputes` and `upheld_disputes`
 *    are included from day one for any fresh install
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  // ── devices ────────────────────────────────────────────────────────────────
  pgm.createTable("devices", {
    address:          { type: "TEXT",    primaryKey: true },
    owner:            { type: "TEXT",    notNull: false },
    device_type:      { type: "TEXT",    notNull: true },
    lat:              { type: "INTEGER", notNull: false },
    lon:              { type: "INTEGER", notNull: false },
    registered_at:    { type: "INTEGER", notNull: true },
    active:           { type: "INTEGER", notNull: true, default: 1 },
    open_disputes:    { type: "INTEGER", notNull: true, default: 0 },
    upheld_disputes:  { type: "INTEGER", notNull: true, default: 0 },
  });

  // ── readings ────────────────────────────────────────────────────────────────
  pgm.createTable("readings", {
    id:             { type: "SERIAL",   primaryKey: true },
    device_address: { type: "TEXT",    notNull: true },
    device_type:    { type: "TEXT",    notNull: false },
    region_code:    { type: "INTEGER", notNull: true },
    epoch:          { type: "INTEGER", notNull: true },
    value:          { type: "INTEGER", notNull: true },
    accepted:       { type: "INTEGER", notNull: true },
    ledger:         { type: "INTEGER", notNull: true },
    closed_at:      { type: "TEXT",    notNull: true },
    tx_hash:        { type: "TEXT",    notNull: true },
  });
  pgm.addConstraint("readings", "readings_tx_hash_device_address_key", "UNIQUE(tx_hash, device_address)");
  pgm.createIndex("readings", "device_address", { name: "idx_readings_device" });
  pgm.createIndex("readings", ["region_code", "epoch"], { name: "idx_readings_region_epoch" });

  // ── claims ─────────────────────────────────────────────────────────────────
  pgm.createTable("claims", {
    id:             { type: "SERIAL",   primaryKey: true },
    device_address: { type: "TEXT",    notNull: true },
    epoch:          { type: "INTEGER", notNull: true },
    payout:         { type: "TEXT",    notNull: true },
    ledger:         { type: "INTEGER", notNull: true },
    closed_at:      { type: "TEXT",    notNull: true },
    tx_hash:        { type: "TEXT",    notNull: true },
  });
  pgm.addConstraint("claims", "claims_device_address_epoch_key", "UNIQUE(device_address, epoch)");
  pgm.createIndex("claims", "device_address", { name: "idx_claims_device" });

  // ── subscriptions ──────────────────────────────────────────────────────────
  pgm.createTable("subscriptions", {
    subscriber:             { type: "TEXT",    primaryKey: true },
    periods_last_purchase:  { type: "INTEGER", notNull: true },
    expiry:                 { type: "INTEGER", notNull: true },
    updated_at_ledger:      { type: "INTEGER", notNull: true },
  });

  // ── ingest_cursor ──────────────────────────────────────────────────────────
  pgm.createTable("ingest_cursor", {
    contract_id:  { type: "TEXT",    primaryKey: true },
    last_ledger:  { type: "INTEGER", notNull: true },
  });

  // ── disputes ───────────────────────────────────────────────────────────────
  pgm.createTable("disputes", {
    id:                  { type: "SERIAL",  primaryKey: true },
    device_address:      { type: "TEXT",   notNull: true },
    disputer:            { type: "TEXT",   notNull: true },
    evidence_hash:       { type: "TEXT",   notNull: true },
    status:              { type: "TEXT",   notNull: true, default: "open" },
    raised_ledger:       { type: "INTEGER",notNull: true },
    raised_closed_at:    { type: "TEXT",   notNull: true },
    raised_tx_hash:      { type: "TEXT",   notNull: true },
    resolved_ledger:     { type: "INTEGER",notNull: false },
    resolved_closed_at:  { type: "TEXT",   notNull: false },
    resolved_tx_hash:    { type: "TEXT",   notNull: false },
  });
  pgm.addConstraint("disputes", "disputes_raised_tx_hash_device_address_key", "UNIQUE(raised_tx_hash, device_address)");
  pgm.createIndex("disputes", "device_address", { name: "idx_disputes_device" });

  // ── auto_slash_events ──────────────────────────────────────────────────────
  pgm.createTable("auto_slash_events", {
    id:             { type: "SERIAL",   primaryKey: true },
    device_address: { type: "TEXT",    notNull: true },
    rejected_count: { type: "INTEGER", notNull: true },
    threshold:      { type: "INTEGER", notNull: true },
    ledger:         { type: "INTEGER", notNull: true },
    closed_at:      { type: "TEXT",    notNull: true },
    tx_hash:        { type: "TEXT",    notNull: true },
  });
  pgm.addConstraint("auto_slash_events", "auto_slash_events_tx_hash_device_address_key", "UNIQUE(tx_hash, device_address)");
  pgm.createIndex("auto_slash_events", "device_address", { name: "idx_auto_slash_device" });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.dropTable("auto_slash_events");
  pgm.dropTable("disputes");
  pgm.dropTable("ingest_cursor");
  pgm.dropTable("subscriptions");
  pgm.dropTable("claims");
  pgm.dropTable("readings");
  pgm.dropTable("devices");
};
