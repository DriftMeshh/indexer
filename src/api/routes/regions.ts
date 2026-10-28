import { Router } from "express";
import type { Db } from "../../db/client.js";
import * as repo from "../../db/repository.js";

export function regionsRouter(db: Db): Router {
  const router = Router();

  router.get("/:code/average", (req, res) => {
    const code = Number(req.params.code);
    const epoch = Number(req.query.epoch);
    if (!Number.isFinite(code) || !Number.isFinite(epoch)) {
      res.status(400).json({ error: "region code and ?epoch= query param must be numbers" });
      return;
    }
    const average = repo.regionAverage(db, code, epoch);
    res.json({ regionCode: code, epoch, average });
  });

  return router;
}
