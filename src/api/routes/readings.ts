import { Router } from "express";
import type { Db } from "../../db/client.js";
import * as repo from "../../db/repository.js";

/**
 * GET /readings?region=<number>&epoch=<number>
 *
 * Returns every individual reading for the given region code and epoch,
 * ordered by ledger descending. Both query params are required and must
 * be valid finite numbers — returns 400 otherwise (same behaviour as
 * the existing /regions/:code/average endpoint for consistency).
 *
 * This route lives here rather than inside regions.ts because the
 * resource being listed is readings (not a region sub-resource), and
 * the region/epoch combination is a filter applied via query params
 * rather than a hierarchical path relationship.
 */
export function readingsRouter(db: Db): Router {
  const router = Router();

  router.get("/", (req, res) => {
    const region = Number(req.query.region);
    const epoch = Number(req.query.epoch);

    if (!Number.isFinite(region) || !Number.isFinite(epoch)) {
      res
        .status(400)
        .json({ error: "?region= and ?epoch= query params are required and must be numbers" });
      return;
    }

    const readings = repo.listReadingsForRegion(db, region, epoch);
    res.json(readings);
  });

  return router;
}
