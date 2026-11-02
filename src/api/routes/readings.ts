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
 *
 * Route placement decision:
 *   - /regions/:code/readings  — would require a URL param for region and
 *     a query param for epoch, mixing conventions inconsistently
 *   - /readings?region=&epoch= — both filters are symmetric query params,
 *     URL is clean, and it matches how data consumers naturally think about
 *     the resource: "give me readings, filtered by region and epoch"
 */
export function readingsRouter(db: Db): Router {
  const router = Router();

  router.get("/", (req, res) => {
    const region = Number(req.query.region);
    const epoch = Number(req.query.epoch);

    // Number(undefined) === NaN and Number("abc") === NaN, both caught by
    // !isFinite. Number("") === 0 which IS finite — that's intentional:
    // region=0 and epoch=0 are valid filter values (a region code or epoch
    // of zero is unusual but not impossible in the contract's domain).
    if (!Number.isFinite(region) || !Number.isFinite(epoch)) {
      const missing: string[] = [];
      if (!Number.isFinite(region)) missing.push("?region=");
      if (!Number.isFinite(epoch)) missing.push("?epoch=");
      res
        .status(400)
        .json({
          error: `${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} required and must be a number`,
        });
      return;
    }

    const readings = repo.listReadingsForRegion(db, region, epoch);
    // Always returns an array — empty when no readings exist for the
    // given region+epoch combination. 404 would be wrong here because
    // the absence of readings is a valid state, not a missing resource.
    res.json(readings);
  });

  return router;
}
