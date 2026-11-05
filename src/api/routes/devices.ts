import { Router } from "express";
import type { Db } from "../../db/client.js";
import * as repo from "../../db/repository.js";
import { DEFAULT_LIMIT, MAX_LIMIT } from "../../db/repository.js";

/**
 * Parses a query-string value into a non-negative integer.
 *
 * Returns null  — value was absent (caller should apply its own default).
 * Returns NaN   — value was present but not a valid finite number.
 * Returns >= 0  — valid parsed integer (Math.trunc applied, so "1.5" → 1).
 *
 * Negative values are returned as-is; the caller checks for < 0 to emit
 * a param-specific error message.
 *
 * Examples:
 *   parseNonNegativeInt(undefined)  → null     (absent)
 *   parseNonNegativeInt("")         → null     (empty string treated as absent)
 *   parseNonNegativeInt("abc")      → NaN      (non-numeric)
 *   parseNonNegativeInt("Infinity") → NaN      (non-finite)
 *   parseNonNegativeInt("-1")       → -1       (caller's job to 400)
 *   parseNonNegativeInt("0")        → 0        (valid)
 *   parseNonNegativeInt("50")       → 50       (valid)
 *   parseNonNegativeInt("1.9")      → 1        (truncated)
 */
function parseNonNegativeInt(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return NaN;
  return Math.trunc(n);
}

export function devicesRouter(db: Db): Router {
  const router = Router();

  /**
   * GET /devices
   *
   * Lists all registered devices, ordered by registration date (newest first).
   *
   * Query params:
   *   limit  — number of records to return (default: 50, max: 500)
   *   offset — number of records to skip    (default: 0)
   *
   * Response shape:
   *   { data: DeviceRow[], total: number, limit: number, offset: number }
   *
   * Error responses:
   *   400 — limit or offset is present but not a valid non-negative integer
   */
  router.get("/", (req, res) => {
    const rawLimit = parseNonNegativeInt(req.query.limit);
    const rawOffset = parseNonNegativeInt(req.query.offset);

    // null means the param was absent — fall back to the sensible defaults.
    // NaN means the param was present but not a valid number — 400.
    // Negative means the param was a valid number but < 0 — 400.
    const limit = rawLimit === null ? DEFAULT_LIMIT : rawLimit;
    const offset = rawOffset === null ? 0 : rawOffset;

    if (!Number.isFinite(limit) || limit < 0) {
      res
        .status(400)
        .json({ error: `"limit" must be a non-negative integer (max ${MAX_LIMIT})` });
      return;
    }
    if (!Number.isFinite(offset) || offset < 0) {
      res.status(400).json({ error: '"offset" must be a non-negative integer' });
      return;
    }

    res.json(repo.listDevices(db, limit, offset));
  });

  router.get("/:address", (req, res) => {
    const device = repo.getDevice(db, req.params.address);
    if (!device) {
      res.status(404).json({ error: "device not found" });
      return;
    }
    res.json(device);
  });

  /**
   * GET /devices/:address/readings
   *
   * Lists readings for a specific device, ordered by ledger (newest first).
   *
   * Query params:
   *   limit  — number of records to return (default: 50, max: 500)
   *   offset — number of records to skip    (default: 0)
   *
   * Response shape:
   *   { data: ReadingRow[], total: number, limit: number, offset: number }
   *
   * Error responses:
   *   400 — limit or offset is present but not a valid non-negative integer
   */
  router.get("/:address/readings", (req, res) => {
    const rawLimit = parseNonNegativeInt(req.query.limit);
    const rawOffset = parseNonNegativeInt(req.query.offset);

    const limit = rawLimit === null ? DEFAULT_LIMIT : rawLimit;
    const offset = rawOffset === null ? 0 : rawOffset;

    if (!Number.isFinite(limit) || limit < 0) {
      res
        .status(400)
        .json({ error: `"limit" must be a non-negative integer (max ${MAX_LIMIT})` });
      return;
    }
    if (!Number.isFinite(offset) || offset < 0) {
      res.status(400).json({ error: '"offset" must be a non-negative integer' });
      return;
    }

    res.json(repo.listReadingsForDevice(db, req.params.address, limit, offset));
  });

  router.get("/:address/claims", (req, res) => {
    res.json(repo.listClaimsForDevice(db, req.params.address));
  });

  return router;
}
