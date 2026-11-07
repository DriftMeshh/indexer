import type { Db } from "./client.js";

/**
 * Pagination constants.
 *
 * DEFAULT_LIMIT (50): a reasonable page size that keeps responses fast for
 * typical fleet sizes without requiring a client to always supply a limit.
 *
 * MAX_LIMIT (500): an upper bound that prevents a single request from
 * returning an unbounded result set. Chosen to be large enough for legitimate
 * bulk-export use-cases while still protecting the database from runaway
 * queries. Requests that exceed this are clamped to 500 rather than rejected,
 * so existing clients that pass a very large limit won't suddenly break.
 *
 * The values 50 and 500 share a 10x ratio intentionally: any client paging
 * with the default limit requires exactly 10 pages to consume a MAX_LIMIT
 * batch, making strategy comparisons easy for consumers.
 */
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 500;

/**
 * Generic wrapper returned by every paginated list endpoint.
 *
 * Shape: { data: T[], total: number, limit: number, offset: number }
 *
 * Why a JSON body envelope instead of response headers?
 *
 *   1. Easier to consume in JavaScript clients — no need to parse Link or
 *      X-Total-Count headers; callers can do `result.total` directly.
 *   2. Pagination metadata survives caching proxies and log aggregators
 *      that may silently drop unknown custom headers.
 *   3. Both list endpoints (GET /devices and GET /devices/:id/readings)
 *      share this type, giving clients a single predictable contract.
 *   4. Keeps the response self-describing: a client that receives a cold
 *      cache entry can see the pagination params that produced it without
 *      reconstructing the original request URL.
 *
 * Fields:
 *   data   — the current page of rows
 *   total  — full count of matching rows across all pages (before LIMIT/OFFSET)
 *   limit  — the effective LIMIT used for this query (may be clamped to MAX_LIMIT)
 *   offset — the OFFSET used for this query (mirrors the request param)
 *
 * Computing the total number of pages from a response:
 *   Math.ceil(result.total / result.limit)   // watch for limit=0 → Infinity
 */
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface DeviceRow {
  address: string;
  owner: string | null;
  device_type: string;
  lat: number | null;
  lon: number | null;
  registered_at: number;
  active: number;
  open_disputes: number;
  upheld_disputes: number;
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
  // open_disputes/upheld_disputes are owned by the dispute repository
  // functions, never set here — the INSERT relies on their column
  // DEFAULT 0, and the ON CONFLICT branch doesn't touch them at all, so
  // an existing device's counts survive a later registration-event replay.
  row: Omit<DeviceRow, "active" | "open_disputes" | "upheld_disputes"> & { active?: number },
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

export function listDevices(
  db: Db,
  limit = DEFAULT_LIMIT,
  offset = 0,
): PaginatedResult<DeviceRow> {
  const clampedLimit = Math.min(limit, MAX_LIMIT);
  // COUNT(*) on a table without a WHERE clause is O(1) in SQLite because
  // the engine reads the row count directly from the database file header.
  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM devices`).get() as { n: number }
  ).n;
  const data = db
    .prepare(`SELECT * FROM devices ORDER BY registered_at DESC LIMIT ? OFFSET ?`)
    .all(clampedLimit, offset) as DeviceRow[];
  return { data, total, limit: clampedLimit, offset };
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

export function listReadingsForDevice(
  db: Db,
  address: string,
  limit = DEFAULT_LIMIT,
  offset = 0,
): PaginatedResult<ReadingRow> {
  const clampedLimit = Math.min(limit, MAX_LIMIT);
  // Unlike the COUNT(*) in listDevices, this COUNT has a WHERE clause so it
  // cannot use the O(1) header shortcut. It requires an index scan on
  // device_address. A future optimisation is to add an index on
  // (device_address, ledger DESC) which would make both this COUNT and the
  // main SELECT use the same index efficiently.
  const total = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM readings WHERE device_address = ?`)
      .get(address) as { n: number }
  ).n;
  const data = db
    .prepare(
      `SELECT * FROM readings WHERE device_address = ? ORDER BY ledger DESC LIMIT ? OFFSET ?`,
    )
    .all(address, clampedLimit, offset) as ReadingRow[];
  return { data, total, limit: clampedLimit, offset };
}

export function regionAverage(db: Db, regionCode: number, epoch: number): number | null {
  const row = db
    .prepare(
      `SELECT AVG(value) as avg FROM readings WHERE region_code = ? AND epoch = ? AND accepted = 1`,
    )
    .get(regionCode, epoch) as { avg: number | null };
  return row.avg;
}

/**
 * Returns all individual readings for a given region code and epoch,
 * ordered by ledger descending (most recent first). Used by GET /readings?region=&epoch=.
 *
 * Does NOT filter by `accepted` — returns both accepted and rejected readings
 * so the consumer can decide which subset matters to them. The existing
 * regionAverage only counts accepted=1 rows because an average of rejected
 * readings is meaningless; raw listing has no such restriction.
 *
 * Ordering by ledger DESC matches listReadingsForDevice, keeping the
 * collection ordering consistent across both "per device" and "per region"
 * reading queries.
 */
export function listReadingsForRegion(
  db: Db,
  regionCode: number,
  epoch: number,
): ReadingRow[] {
  return db
    .prepare(
      `SELECT * FROM readings WHERE region_code = ? AND epoch = ? ORDER BY ledger DESC`,
    )
    .all(regionCode, epoch) as ReadingRow[];
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

export interface DisputeRow {
  id: number;
  device_address: string;
  disputer: string;
  evidence_hash: string;
  status: "open" | "upheld" | "dismissed";
  raised_ledger: number;
  raised_closed_at: string;
  raised_tx_hash: string;
  resolved_ledger: number | null;
  resolved_closed_at: string | null;
  resolved_tx_hash: string | null;
}

/** Inserts a new open dispute and bumps the device's denormalized open_disputes count. */
export function insertDispute(
  db: Db,
  row: {
    device_address: string;
    disputer: string;
    evidence_hash: string;
    raised_ledger: number;
    raised_closed_at: string;
    raised_tx_hash: string;
  },
): void {
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO disputes
         (device_address, disputer, evidence_hash, raised_ledger, raised_closed_at, raised_tx_hash)
       VALUES (@device_address, @disputer, @evidence_hash, @raised_ledger, @raised_closed_at, @raised_tx_hash)`,
    )
    .run(row);
  // INSERT OR IGNORE silently no-ops on a duplicate (tx_hash, device_address)
  // — a re-ingested overlapping poll window, same pattern as insertReading.
  // Only bump the count for a genuinely new row.
  if (result.changes > 0) {
    db.prepare(`UPDATE devices SET open_disputes = open_disputes + 1 WHERE address = ?`).run(
      row.device_address,
    );
  }
}

/**
 * Resolves whichever dispute is still open for this device — matches by
 * status alone, not a dispute ID, because device-registry's
 * `dispute_resolved` event doesn't carry one and only allows one open
 * dispute per device at a time (see client.ts's disputes table comment).
 * A resolution with no matching open row (e.g. ingested out of order, or
 * a dispute raised before this indexer started watching the contract) is
 * logged by the caller and otherwise a safe no-op — there's nothing to
 * update.
 */
export function resolveDispute(
  db: Db,
  row: {
    device_address: string;
    upheld: boolean;
    resolved_ledger: number;
    resolved_closed_at: string;
    resolved_tx_hash: string;
  },
): boolean {
  const open = db
    .prepare(
      `SELECT id FROM disputes WHERE device_address = ? AND status = 'open'
       ORDER BY raised_ledger DESC LIMIT 1`,
    )
    .get(row.device_address) as { id: number } | undefined;
  if (!open) return false;

  db.prepare(
    `UPDATE disputes SET status = ?, resolved_ledger = ?, resolved_closed_at = ?, resolved_tx_hash = ?
     WHERE id = ?`,
  ).run(row.upheld ? "upheld" : "dismissed", row.resolved_ledger, row.resolved_closed_at, row.resolved_tx_hash, open.id);

  db.prepare(`UPDATE devices SET open_disputes = MAX(open_disputes - 1, 0) WHERE address = ?`).run(
    row.device_address,
  );
  if (row.upheld) {
    db.prepare(`UPDATE devices SET upheld_disputes = upheld_disputes + 1 WHERE address = ?`).run(
      row.device_address,
    );
  }
  return true;
}

export function listDisputesForDevice(db: Db, address: string): DisputeRow[] {
  return db
    .prepare(`SELECT * FROM disputes WHERE device_address = ? ORDER BY raised_ledger DESC`)
    .all(address) as DisputeRow[];
}

export interface AutoSlashEventRow {
  id: number;
  device_address: string;
  rejected_count: number;
  threshold: number;
  ledger: number;
  closed_at: string;
  tx_hash: string;
}

export function insertAutoSlashEvent(db: Db, row: Omit<AutoSlashEventRow, "id">): void {
  db.prepare(
    `INSERT OR IGNORE INTO auto_slash_events
       (device_address, rejected_count, threshold, ledger, closed_at, tx_hash)
     VALUES (@device_address, @rejected_count, @threshold, @ledger, @closed_at, @tx_hash)`,
  ).run(row);
}
