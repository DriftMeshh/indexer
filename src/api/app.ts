import express, { type Express } from "express";
import type { Db } from "../db/client.js";
import { devicesRouter } from "./routes/devices.js";
import { regionsRouter } from "./routes/regions.js";
import { subscriptionsRouter } from "./routes/subscriptions.js";

export function createApp(db: Db): Express {
  const app = express();
  app.use(express.json());

  // Every route here is a public, read-only GET with no credentials
  // involved, so a wildcard origin is appropriate — this just lets a
  // frontend hosted on a different origin (e.g. Vercel) call this API
  // directly, since it won't have Vite's dev-only /api proxy in prod.
  app.use((_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    next();
  });

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.use("/devices", devicesRouter(db));
  app.use("/regions", regionsRouter(db));
  app.use("/subscriptions", subscriptionsRouter(db));

  return app;
}
