import { Router } from "express";
import type { Config } from "../../config.js";
import { fetchEpochStatus } from "../../stellar/epochs.js";

export function epochsRouter(config: Config): Router {
  const router = Router();

  router.get("/:epoch", async (req, res) => {
    const epoch = Number(req.params.epoch);
    if (!Number.isInteger(epoch) || epoch < 0) {
      res.status(400).json({ error: "epoch must be a non-negative integer" });
      return;
    }

    const status = await fetchEpochStatus(
      config.rpcUrl,
      config.networkPassphrase,
      config.contracts.submissionValidator,
      config.contracts.paymentStreamer,
      epoch,
    );
    if (!status) {
      res.status(503).json({
        error:
          "epoch status unavailable — submission-validator/payment-streamer contract IDs may not be configured, or the RPC read failed",
      });
      return;
    }
    res.json(status);
  });

  return router;
}
