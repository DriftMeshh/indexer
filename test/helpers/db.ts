/**
 * Test database helpers for Postgres.
 *
 * Each test file that needs a database calls `createTestDb()` in
 * `beforeEach` and `closeTestDb(db)` in `afterEach`.  The helper creates
 * a fresh schema by dropping and recreating all tables on every setup,
 * giving every test a clean slate without the overhead of spinning up a
 * new Postgres cluster per test.
 *
 * Connection string precedence:
 *   TEST_DATABASE_URL env var  →  use as-is (CI / custom local setup)
 *   default                    →  postgresql://driftmesh:driftmesh@127.0.0.1:5432/driftmesh
 *
 * The test database is a separate concern from the production database —
 * tests never touch the production URL; they only ever connect to
 * TEST_DATABASE_URL (or the local default above).
 */

import { openDb, type Db } from "../../src/db/client.js";

export const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://driftmesh:driftmesh@127.0.0.1:5432/driftmesh";

/**
 * Opens a connection pool that has already run all migrations.
 * Call this in `beforeEach`.
 */
export async function createTestDb(): Promise<Db> {
  const db = await openDb(TEST_DB_URL);
  // Truncate every application table in dependency order so each test
  // starts with an empty dataset but the schema is already in place.
  // TRUNCATE ... CASCADE is faster than DROP/recreate for repeated runs.
  await db.query(`
    TRUNCATE TABLE
      auto_slash_events,
      disputes,
      ingest_cursor,
      subscriptions,
      claims,
      readings,
      devices
    RESTART IDENTITY CASCADE
  `);
  return db;
}

/**
 * Closes the pool.  Call this in `afterEach`.
 */
export async function closeTestDb(db: Db): Promise<void> {
  await db.end();
}
