import type { Db } from "./client.js";

export interface DeviceRow {
  address: string;
  owner: string | null;
  device_type: string;
  lat: number | null;
  lon: number | null;
  registered_at: number;
  active: number;
}

export interface ReadingRow {
  id: number;
  device_address: string;
  device_type: string | null;
  region_code: number;
  epoch: number;
  value: number;
  accepted: number;
  ledger: number;
  closed_at: string;
  tx_hash: string;
}

export interface ClaimRow {
  id: number;
  device_address: string;
  epoch: number;
  payout: string;
  ledger: number;
  closed_at: string;
  tx_hash: string;
}

export interface SubscriptionRow {
  subscriber: string;
  periods_last_purchase: number;
  expiry: number;
  updated_at_ledger: number;
}

export function upsertDevice(
  db: Db,
  row: Omit<DeviceRow, "active"> & { active?: number },
): void {
  db.prepare(
    `INSERT INTO devices (address, owner, device_type, lat, lon, registered_at, active)
     VALUES (@address, @owner, @device_type, @lat, @lon, @registered_at, @active)
     ON CONFLICT(address) DO UPDATE SET
       owner = COALESCE(excluded.owner, devices.owner),
       device_type = excluded.device_type,
       lat = COALESCE(excluded.lat, devices.lat),
       lon = COALESCE(excluded.lon, devices.lon),
       active = excluded.active`,
  ).run({ active: 1, ...row });
}

export function setDeviceActive(db: Db, address: string, active: boolean): void {
  db.prepare(`UPDATE devices SET active = ? WHERE address = ?`).run(active ? 1 : 0, address);
}

export function listDevices(db: Db): DeviceRow[] {
  return db.prepare(`SELECT * FROM devices ORDER BY registered_at DESC`).all() as DeviceRow[];
}

export function getDevice(db: Db, address: string): DeviceRow | undefined {
  return db.prepare(`SELECT * FROM devices WHERE address = ?`).get(address) as
    | DeviceRow
    | undefined;
}

export function insertReading(db: Db, row: Omit<ReadingRow, "id">): void {
  db.prepare(
    `INSERT OR IGNORE INTO readings
       (device_address, device_type, region_code, epoch, value, accepted, ledger, closed_at, tx_hash)
     VALUES (@device_address, @device_type, @region_code, @epoch, @value, @accepted, @ledger, @closed_at, @tx_hash)`,
  ).run(row);
}

export function listReadingsForDevice(db: Db, address: string, limit = 100): ReadingRow[] {
  return db
    .prepare(`SELECT * FROM readings WHERE device_address = ? ORDER BY ledger DESC LIMIT ?`)
    .all(address, limit) as ReadingRow[];
}

export function regionAverage(db: Db, regionCode: number, epoch: number): number | null {
  const row = db
    .prepare(
      `SELECT AVG(value) as avg FROM readings WHERE region_code = ? AND epoch = ? AND accepted = 1`,
    )
    .get(regionCode, epoch) as { avg: number | null };
  return row.avg;
}

export function insertClaim(db: Db, row: Omit<ClaimRow, "id">): void {
  db.prepare(
    `INSERT OR IGNORE INTO claims (device_address, epoch, payout, ledger, closed_at, tx_hash)
     VALUES (@device_address, @epoch, @payout, @ledger, @closed_at, @tx_hash)`,
  ).run(row);
}

export function listClaimsForDevice(db: Db, address: string): ClaimRow[] {
  return db
    .prepare(`SELECT * FROM claims WHERE device_address = ? ORDER BY epoch DESC`)
    .all(address) as ClaimRow[];
}

export function upsertSubscription(db: Db, row: SubscriptionRow): void {
  db.prepare(
    `INSERT INTO subscriptions (subscriber, periods_last_purchase, expiry, updated_at_ledger)
     VALUES (@subscriber, @periods_last_purchase, @expiry, @updated_at_ledger)
     ON CONFLICT(subscriber) DO UPDATE SET
       periods_last_purchase = excluded.periods_last_purchase,
       expiry = excluded.expiry,
       updated_at_ledger = excluded.updated_at_ledger
     WHERE excluded.updated_at_ledger >= subscriptions.updated_at_ledger`,
  ).run(row);
}

export function getSubscription(db: Db, subscriber: string): SubscriptionRow | undefined {
  return db.prepare(`SELECT * FROM subscriptions WHERE subscriber = ?`).get(subscriber) as
    | SubscriptionRow
    | undefined;
}

export function getCursor(db: Db, contractId: string): number {
  const row = db
    .prepare(`SELECT last_ledger FROM ingest_cursor WHERE contract_id = ?`)
    .get(contractId) as { last_ledger: number } | undefined;
  return row?.last_ledger ?? 0;
}

export function setCursor(db: Db, contractId: string, lastLedger: number): void {
  db.prepare(
    `INSERT INTO ingest_cursor (contract_id, last_ledger) VALUES (?, ?)
     ON CONFLICT(contract_id) DO UPDATE SET last_ledger = excluded.last_ledger`,
  ).run(contractId, lastLedger);
}
