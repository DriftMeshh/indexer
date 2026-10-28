import { Router } from "express";
import type { Db } from "../../db/client.js";
import * as repo from "../../db/repository.js";

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
