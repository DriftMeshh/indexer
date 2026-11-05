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
 */
function parseNonNegativeInt(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return NaN;
  return Math.trunc(n);
}

export function devicesRouter(db: Db): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(repo.listDevices(db));
  });

  router.get("/:address", (req, res) => {
    const device = repo.getDevice(db, req.params.address);
    if (!device) {
      res.status(404).json({ error: "device not found" });
      return;
    }
    res.json(device);
  });

  router.get("/:address/readings", (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    res.json(repo.listReadingsForDevice(db, req.params.address, limit));
  });

  router.get("/:address/claims", (req, res) => {
    res.json(repo.listClaimsForDevice(db, req.params.address));
  });

  return router;
}
