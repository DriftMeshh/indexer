import { Router } from "express";
import type { Db } from "../../db/client.js";
import * as repo from "../../db/repository.js";

export function subscriptionsRouter(db: Db): Router {
  const router = Router();

  router.get("/:address", (req, res) => {
    const sub = repo.getSubscription(db, req.params.address);
    if (!sub) {
      res.json({ subscriber: req.params.address, active: false, expiry: 0 });
      return;
    }
    res.json({ ...sub, active: sub.expiry > Math.floor(Date.now() / 1000) });
  });

  return router;
}
