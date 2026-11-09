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

/**
 * Normalise a row returned by `pg` so that every column whose TypeScript type
 * is `number` (INTEGER in Postgres) is actually a JS number, not a string.
 *
 * `pg` returns all numeric columns as strings by default unless a type parser
 * is configured globally.  Rather than patching the global type-parser map
 * (which would affect every pool in the process), we cast selectively per
 * query helper.  Only columns that are `number` in the row interface need
 * casting; TEXT columns are already the right type.
 */
function toInts<T extends object>(row: Record<string, unknown>, keys: (keyof T)[]): T {
  const out = { ...row } as Record<string, unknown>;
  for (const k of keys as string[]) {
    if (out[k] !== null && out[k] !== undefined) {
      out[k] = Number(out[k]);
    }
  }
  return out as T;
}

const DEVICE_INT_COLS: (keyof DeviceRow)[] = [
  "registered_at", "active", "open_disputes", "upheld_disputes", "lat", "lon",
];
const READING_INT_COLS: (keyof ReadingRow)[] = [
  "id", "region_code", "epoch", "value", "accepted", "ledger",
];
const CLAIM_INT_COLS: (keyof ClaimRow)[] = ["id", "epoch", "ledger"];
const SUBSCRIPTION_INT_COLS: (keyof SubscriptionRow)[] = [
  "periods_last_purchase", "expiry", "updated_at_ledger",
];
const DISPUTE_INT_COLS: (keyof DisputeRow)[] = [
  "id", "raised_ledger", "resolved_ledger",
];
const AUTO_SLASH_INT_COLS: (keyof AutoSlashEventRow)[] = [
  "id", "rejected_count", "threshold", "ledger",
];

export async function upsertDevice(
  db: Db,
  // open_disputes/upheld_disputes are owned by the dispute repository
  // functions, never set here — the INSERT relies on their column
  // DEFAULT 0, and the ON CONFLICT branch doesn't touch them at all, so
  // an existing device's counts survive a later registration-event replay.
  row: Omit<DeviceRow, "active" | "open_disputes" | "upheld_disputes"> & { active?: number },
): Promise<void> {
  const active = row.active ?? 1;
  await db.query(
    `INSERT INTO devices (address, owner, device_type, lat, lon, registered_at, active)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT(address) DO UPDATE SET
       owner       = COALESCE(EXCLUDED.owner,      devices.owner),
       device_type = EXCLUDED.device_type,
       lat         = COALESCE(EXCLUDED.lat,        devices.lat),
       lon         = COALESCE(EXCLUDED.lon,        devices.lon),
       active      = EXCLUDED.active`,
    [row.address, row.owner, row.device_type, row.lat, row.lon, row.registered_at, active],
  );
}

export async function setDeviceActive(db: Db, address: string, active: boolean): Promise<void> {
  await db.query(`UPDATE devices SET active = $1 WHERE address = $2`, [active ? 1 : 0, address]);
}

export async function listDevices(
  db: Db,
  limit = DEFAULT_LIMIT,
  offset = 0,
): Promise<PaginatedResult<DeviceRow>> {
  const clampedLimit = Math.min(limit, MAX_LIMIT);
  const [countResult, dataResult] = await Promise.all([
    db.query<{ n: string }>(`SELECT COUNT(*) AS n FROM devices`),
    db.query(
      `SELECT * FROM devices ORDER BY registered_at DESC LIMIT $1 OFFSET $2`,
      [clampedLimit, offset],
    ),
  ]);
  const total = Number(countResult.rows[0].n);
  const data = dataResult.rows.map((r) => toInts<DeviceRow>(r, DEVICE_INT_COLS));
  return { data, total, limit: clampedLimit, offset };
}

export async function getDevice(db: Db, address: string): Promise<DeviceRow | undefined> {
  const result = await db.query(`SELECT * FROM devices WHERE address = $1`, [address]);
  if (result.rows.length === 0) return undefined;
  return toInts<DeviceRow>(result.rows[0], DEVICE_INT_COLS);
}

export async function insertReading(db: Db, row: Omit<ReadingRow, "id">): Promise<void> {
  await db.query(
    `INSERT INTO readings
       (device_address, device_type, region_code, epoch, value, accepted, ledger, closed_at, tx_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (tx_hash, device_address) DO NOTHING`,
    [
      row.device_address, row.device_type, row.region_code, row.epoch,
      row.value, row.accepted, row.ledger, row.closed_at, row.tx_hash,
    ],
  );
}

export async function listReadingsForDevice(
  db: Db,
  address: string,
  limit = DEFAULT_LIMIT,
  offset = 0,
): Promise<PaginatedResult<ReadingRow>> {
  const clampedLimit = Math.min(limit, MAX_LIMIT);
  const [countResult, dataResult] = await Promise.all([
    db.query<{ n: string }>(`SELECT COUNT(*) AS n FROM readings WHERE device_address = $1`, [address]),
    db.query(
      `SELECT * FROM readings WHERE device_address = $1 ORDER BY ledger DESC LIMIT $2 OFFSET $3`,
      [address, clampedLimit, offset],
    ),
  ]);
  const total = Number(countResult.rows[0].n);
  const data = dataResult.rows.map((r) => toInts<ReadingRow>(r, READING_INT_COLS));
  return { data, total, limit: clampedLimit, offset };
}

export async function regionAverage(
  db: Db,
  regionCode: number,
  epoch: number,
): Promise<number | null> {
  const result = await db.query<{ avg: string | null }>(
    `SELECT AVG(value) as avg FROM readings WHERE region_code = $1 AND epoch = $2 AND accepted = 1`,
    [regionCode, epoch],
  );
  const avg = result.rows[0]?.avg;
  return avg === null || avg === undefined ? null : Number(avg);
}

/**
 * Returns all individual readings for a given region code and epoch,
 * ordered by ledger descending (most recent first). Used by GET /readings?region=&epoch=.
 *
 * Does NOT filter by `accepted` — returns both accepted and rejected readings
 * so the consumer can decide which subset matters to them. The existing
 * regionAverage only counts accepted=1 rows because an average of rejected
 * readings is meaningless; raw listing has no such restriction.
 */
export async function listReadingsForRegion(
  db: Db,
  regionCode: number,
  epoch: number,
): Promise<ReadingRow[]> {
  const result = await db.query(
    `SELECT * FROM readings WHERE region_code = $1 AND epoch = $2 ORDER BY ledger DESC`,
    [regionCode, epoch],
  );
  return result.rows.map((r) => toInts<ReadingRow>(r, READING_INT_COLS));
}

export async function insertClaim(db: Db, row: Omit<ClaimRow, "id">): Promise<void> {
  await db.query(
    `INSERT INTO claims (device_address, epoch, payout, ledger, closed_at, tx_hash)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (device_address, epoch) DO NOTHING`,
    [row.device_address, row.epoch, row.payout, row.ledger, row.closed_at, row.tx_hash],
  );
}

export async function listClaimsForDevice(db: Db, address: string): Promise<ClaimRow[]> {
  const result = await db.query(
    `SELECT * FROM claims WHERE device_address = $1 ORDER BY epoch DESC`,
    [address],
  );
  return result.rows.map((r) => toInts<ClaimRow>(r, CLAIM_INT_COLS));
}

export async function upsertSubscription(db: Db, row: SubscriptionRow): Promise<void> {
  await db.query(
    `INSERT INTO subscriptions (subscriber, periods_last_purchase, expiry, updated_at_ledger)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT(subscriber) DO UPDATE SET
       periods_last_purchase = EXCLUDED.periods_last_purchase,
       expiry                = EXCLUDED.expiry,
       updated_at_ledger     = EXCLUDED.updated_at_ledger
     WHERE EXCLUDED.updated_at_ledger >= subscriptions.updated_at_ledger`,
    [row.subscriber, row.periods_last_purchase, row.expiry, row.updated_at_ledger],
  );
}

export async function getSubscription(
  db: Db,
  subscriber: string,
): Promise<SubscriptionRow | undefined> {
  const result = await db.query(
    `SELECT * FROM subscriptions WHERE subscriber = $1`,
    [subscriber],
  );
  if (result.rows.length === 0) return undefined;
  return toInts<SubscriptionRow>(result.rows[0], SUBSCRIPTION_INT_COLS);
}

export async function getCursor(db: Db, contractId: string): Promise<number> {
  const result = await db.query<{ last_ledger: string }>(
    `SELECT last_ledger FROM ingest_cursor WHERE contract_id = $1`,
    [contractId],
  );
  return result.rows.length > 0 ? Number(result.rows[0].last_ledger) : 0;
}

export async function setCursor(
  db: Db,
  contractId: string,
  lastLedger: number,
): Promise<void> {
  await db.query(
    `INSERT INTO ingest_cursor (contract_id, last_ledger) VALUES ($1, $2)
     ON CONFLICT(contract_id) DO UPDATE SET last_ledger = EXCLUDED.last_ledger`,
    [contractId, lastLedger],
  );
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
export async function insertDispute(
  db: Db,
  row: {
    device_address: string;
    disputer: string;
    evidence_hash: string;
    raised_ledger: number;
    raised_closed_at: string;
    raised_tx_hash: string;
  },
): Promise<void> {
  // Use a transaction to keep the INSERT and the counter UPDATE atomic.
  // INSERT ... ON CONFLICT DO NOTHING returns 0 rows affected on a
  // duplicate (same pattern as insertReading / insertClaim) — we only
  // bump the counter for a genuinely new row.
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO disputes
         (device_address, disputer, evidence_hash, raised_ledger, raised_closed_at, raised_tx_hash)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (raised_tx_hash, device_address) DO NOTHING`,
      [
        row.device_address, row.disputer, row.evidence_hash,
        row.raised_ledger, row.raised_closed_at, row.raised_tx_hash,
      ],
    );
    if (result.rowCount && result.rowCount > 0) {
      await client.query(
        `UPDATE devices SET open_disputes = open_disputes + 1 WHERE address = $1`,
        [row.device_address],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
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
export async function resolveDispute(
  db: Db,
  row: {
    device_address: string;
    upheld: boolean;
    resolved_ledger: number;
    resolved_closed_at: string;
    resolved_tx_hash: string;
  },
): Promise<boolean> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const openResult = await client.query<{ id: number }>(
      `SELECT id FROM disputes WHERE device_address = $1 AND status = 'open'
       ORDER BY raised_ledger DESC LIMIT 1`,
      [row.device_address],
    );
    if (openResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return false;
    }

    const openId = openResult.rows[0].id;
    const newStatus = row.upheld ? "upheld" : "dismissed";

    await client.query(
      `UPDATE disputes
       SET status = $1, resolved_ledger = $2, resolved_closed_at = $3, resolved_tx_hash = $4
       WHERE id = $5`,
      [newStatus, row.resolved_ledger, row.resolved_closed_at, row.resolved_tx_hash, openId],
    );

    await client.query(
      `UPDATE devices SET open_disputes = GREATEST(open_disputes - 1, 0) WHERE address = $1`,
      [row.device_address],
    );

    if (row.upheld) {
      await client.query(
        `UPDATE devices SET upheld_disputes = upheld_disputes + 1 WHERE address = $1`,
        [row.device_address],
      );
    }

    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listDisputesForDevice(
  db: Db,
  address: string,
): Promise<DisputeRow[]> {
  const result = await db.query(
    `SELECT * FROM disputes WHERE device_address = $1 ORDER BY raised_ledger DESC`,
    [address],
  );
  return result.rows.map((r) => toInts<DisputeRow>(r, DISPUTE_INT_COLS));
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

export async function insertAutoSlashEvent(
  db: Db,
  row: Omit<AutoSlashEventRow, "id">,
): Promise<void> {
  await db.query(
    `INSERT INTO auto_slash_events
       (device_address, rejected_count, threshold, ledger, closed_at, tx_hash)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tx_hash, device_address) DO NOTHING`,
    [row.device_address, row.rejected_count, row.threshold, row.ledger, row.closed_at, row.tx_hash],
  );
}
