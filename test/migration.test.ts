import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { openDb } from "../src/db/client.js";
import * as repo from "../src/db/repository.js";

describe("openDb migration", () => {
  it("adds open_disputes/upheld_disputes to a devices table that pre-dates them", () => {
    const dir = mkdtempSync(join(tmpdir(), "driftmesh-migration-test-"));
    const path = join(dir, "old.sqlite");

    // Simulate a database created before the dispute-count columns existed.
    const old = new Database(path);
    old.exec(`
      CREATE TABLE devices (
        address TEXT PRIMARY KEY,
        owner TEXT,
        device_type TEXT NOT NULL,
        lat INTEGER,
        lon INTEGER,
        registered_at INTEGER NOT NULL,
        active INTEGER NOT NULL DEFAULT 1
      );
    `);
    old.prepare(
      `INSERT INTO devices (address, owner, device_type, lat, lon, registered_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("DEV_PRE_EXISTING", "OWNER1", "weather", 10, 20, 1000);
    old.close();

    // openDb on the same file path should add the missing columns rather
    // than fail or silently leave them off.
    const db = openDb(path);
    const columns = db.prepare(`PRAGMA table_info(devices)`).all() as Array<{ name: string }>;
    const columnNames = columns.map((c) => c.name);
    expect(columnNames).toContain("open_disputes");
    expect(columnNames).toContain("upheld_disputes");

    // The pre-existing row survives the migration with the new columns
    // defaulted, not dropped or corrupted.
    const device = repo.getDevice(db, "DEV_PRE_EXISTING");
    expect(device).toMatchObject({ owner: "OWNER1", open_disputes: 0, upheld_disputes: 0 });
  });

  it("is idempotent — opening an already-migrated database again doesn't error", () => {
    const dir = mkdtempSync(join(tmpdir(), "driftmesh-migration-test-"));
    const path = join(dir, "twice.sqlite");

    openDb(path).close();
    expect(() => openDb(path)).not.toThrow();
  });
});
