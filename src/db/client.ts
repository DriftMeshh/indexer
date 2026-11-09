import { Pool } from "pg";
import { runner as runMigrations } from "node-pg-migrate";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * `Db` is the shared connection-pool type passed through the entire
 * application.  Every function in `repository.ts` accepts a `Db` so
 * that the pool is created once at startup and reused across requests
 * and poll cycles.
 *
 * We expose the raw `Pool` rather than a single `Client` so that
 * concurrent HTTP requests and the background poller can each borrow
 * a connection from the pool independently without serializing on a
 * single connection.
 */
export type Db = Pool;

const __dirname = dirname(fileURLToPath(import.meta.url));
// Migrations live at <repo-root>/migrations/ regardless of whether we're
// running from src/ (ts-node/tsx) or dist/ (compiled JS).
const MIGRATIONS_DIR = join(__dirname, "../../migrations");

/**
 * Opens a connection pool to the Postgres database at `connectionString`
 * and runs any pending migrations before returning.
 *
 * Pass `":memory:"` (the old SQLite sentinel) as `connectionString` only
 * in tests via the `TEST_DATABASE_URL` env var indirection — the actual
 * connection string must be a valid `postgresql://` URL in all real
 * environments.
 *
 * Why run migrations here instead of as a separate deploy step?
 *  - For a single-instance service this is safe: the pool is created
 *    before any request is served, so migrations always complete first.
 *  - `node-pg-migrate` uses an advisory lock (`pgmigrations` table +
 *    Postgres advisory lock) so concurrent restarts don't double-apply.
 *  - For multi-instance (e.g. k8s rolling deploy) the safe pattern is
 *    a pre-deploy migration job; this function still works there because
 *    `node-pg-migrate` is idempotent — already-applied migrations are
 *    skipped.
 */
export async function openDb(connectionString: string): Promise<Db> {
  const pool = new Pool({ connectionString });

  // Verify connectivity before running migrations so the error is
  // "cannot connect to Postgres" rather than a confusing migration error.
  await pool.query("SELECT 1");

  await runMigrations({
    databaseUrl: connectionString,
    migrationsTable: "pgmigrations",
    dir: MIGRATIONS_DIR,
    direction: "up",
    log: () => {},   // silence migration output; errors still throw
    // node-pg-migrate can receive either a URL string or a pool; passing
    // the string lets it manage its own short-lived connection for the
    // migration transaction, which avoids tying up a pool slot.
  });

  return pool;
}
