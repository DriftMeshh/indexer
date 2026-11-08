import express, { type Express, type Request, type Response, type NextFunction } from "express";
import rateLimit from "express-rate-limit";
import type { Db } from "../db/client.js";
import type { Config } from "../config.js";
import { devicesRouter } from "./routes/devices.js";
import { regionsRouter } from "./routes/regions.js";
import { subscriptionsRouter } from "./routes/subscriptions.js";
import { readingsRouter } from "./routes/readings.js";
import { epochsRouter } from "./routes/epochs.js";
import { metricsRouter } from "./routes/metrics.js";
import { logger, serializeError } from "../logger.js";
import type { PollerMetrics } from "../ingest/poller.js";

/**
 * `config` is optional so existing callers (and most tests, which only
 * exercise the DB-backed routes) don't need to supply one. Without it,
 * GET /epochs/:epoch always responds 503 — it needs live RPC access,
 * which isn't meaningful against an in-memory test DB anyway. GET /metrics
 * still works without `config`, just without the ledger-lag gauges.
 *
 * `getPollerMetrics` is a callback (not the metrics themselves) so GET
 * /metrics always reflects the poller's *current* state — see
 * routes/metrics.ts for why.
 */
export function createApp(
  db: Db,
  config?: Config,
  getPollerMetrics?: () => PollerMetrics | undefined,
): Express {
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

  // Request logger — records method, path, status code, and round-trip
  // duration in milliseconds. Runs after the response is finished so the
  // status code is final.
  //
  // Uses res.on("finish") rather than inline logging before next() so that
  // the status code and duration are both available — if we logged before
  // calling next() we'd always see 200 regardless of what the route set,
  // and we'd have no duration since the route hasn't run yet.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on("finish", () => {
      const ms = Date.now() - start;
      logger.info("api", "request", {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms,
      });
    });
    next();
  });

  // Rate limiting and the optional API-key check are both gated on
  // `config` being supplied — same reasoning as epochs/metrics above.
  // Without this gate, every test file that calls createApp(db) with no
  // config (the large majority — see api.test.ts's many requests per
  // test) would need to worry about tripping a default rate limit it
  // never asked for.
  if (config) {
    app.use(
      rateLimit({
        windowMs: config.rateLimit.windowMs,
        limit: config.rateLimit.max,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: "too many requests, try again later" },
        // /health is a liveness check a host or monitor may hit far more
        // often than config.rateLimit.max allows — it should never be
        // the reason a deployment looks "down".
        skip: (req) => req.path === "/health",
      }),
    );

    if (config.apiKey) {
      const apiKey = config.apiKey;
      app.use((req: Request, res: Response, next: NextFunction) => {
        if (req.path === "/health") {
          next();
          return;
        }
        if (req.header("X-API-Key") !== apiKey) {
          res.status(401).json({ error: "missing or invalid X-API-Key" });
          return;
        }
        next();
      });
    }
  }

  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.use("/metrics", metricsRouter(db, config, getPollerMetrics));

  app.use("/devices", devicesRouter(db));
  app.use("/regions", regionsRouter(db));
  app.use("/subscriptions", subscriptionsRouter(db));
  app.use("/readings", readingsRouter(db));
  if (config) {
    app.use("/epochs", epochsRouter(config));
  } else {
    app.get("/epochs/:epoch", (_req, res) =>
      res.status(503).json({ error: "epoch status unavailable — no config supplied to createApp" }),
    );
  }

  // Centralized error-handling middleware — must be registered after all
  // routes (Express uses the 4-argument signature to detect error handlers).
  // Catches anything passed to next(err) or thrown inside an async route
  // (when wrapped with a try/catch that forwards to next). Returns a
  // consistent JSON error shape instead of Express's default HTML page,
  // which is important for any machine consumer of this API.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : "internal server error";
    logger.error("api", "unhandled error", serializeError(err));
    res.status(500).json({ error: message });
  });

  return app;
}
