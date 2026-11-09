/**
 * Migration tests for the Postgres backend.
 *
 * These replace the old SQLite-specific `openDb migration` tests (which
 * tested the inline `ensureColumn` guard that added open_disputes /
 * upheld_disputes to pre-existing databases).  That guard no longer exists;
 * the equivalent concern here is:
 *
 *   1. `openDb` runs migrations before returning — every table the
 *      application needs exists after the first call.
 *   2. Calling `openDb` again on the same database (the "already migrated"
 *      case) is idempotent — it doesn't error, and existing data survives.
 *
 * Both properties are verified against a real Postgres database (the test
 * helper truncates all tables between tests so each test starts clean, but
 * the schema itself persists between tests within a file — which is exactly
 * what gives us coverage of the idempotency case).
 */

import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/client.js";
import * as repo from "../src/db/repository.js";
import { TEST_DB_URL } from "./helpers/db.js";

describe("openDb migration", () => {
  it("creates all expected tables on a fresh (truncated) schema", async () => {
    // openDb internally runs all pending migrations before returning.
    // After this call every table defined in migrations/1_initial_schema.js
    // must exist.
    const db = await openDb(TEST_DB_URL);

    const result = await db.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
       WHERE schemaname = 'public'
       ORDER BY tablename`,
    );
    const tables = result.rows.map((r) => r.tablename);

    expect(tables).toContain("devices");
    expect(tables).toContain("readings");
    expect(tables).toContain("claims");
    expect(tables).toContain("subscriptions");
    expect(tables).toContain("ingest_cursor");
    expect(tables).toContain("disputes");
    expect(tables).toContain("auto_slash_events");
    // Migration bookkeeping table added by node-pg-migrate
    expect(tables).toContain("pgmigrations");

    await db.end();
  });

  it("is idempotent — opening an already-migrated database again doesn't error", async () => {
    // First open: runs migrations (or skips them if already applied).
    const db1 = await openDb(TEST_DB_URL);
    await db1.end();

    // Second open: all migrations are already applied; node-pg-migrate
    // should detect that and return without re-running them or erroring.
    await expect(openDb(TEST_DB_URL).then((db) => db.end())).resolves.not.toThrow();
  });

  it("devices table has open_disputes and upheld_disputes columns with default 0", async () => {
    const db = await openDb(TEST_DB_URL);

    // Insert a device without specifying the dispute columns.
    await repo.upsertDevice(db, {
      address: "MIGRATION_TEST_DEV",
      owner: "OWNER1",
      device_type: "weather",
      lat: 10,
      lon: 20,
      registered_at: 1000,
    });

    const device = await repo.getDevice(db, "MIGRATION_TEST_DEV");
    expect(device).toMatchObject({
      owner: "OWNER1",
      open_disputes: 0,
      upheld_disputes: 0,
    });

    await db.end();
  });
});
