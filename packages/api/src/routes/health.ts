/**
 * Health Routes
 *
 * GET /health  — Liveness probe
 * GET /ready   — Readiness probe (dependency checks)
 * GET /metrics — Prometheus-compatible metrics (placeholder)
 */

import { Router, type Request, type Response } from "express";

const startedAt = Date.now();
let version = "0.0.0";
try { version = require("../../package.json").version; } catch {}

export function healthRouter(): Router {
  const router = Router();

  // Liveness
  router.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      service: "nella-api",
      version,
      uptime: Math.floor((Date.now() - startedAt) / 1000),
      timestamp: new Date().toISOString(),
    });
  });

  // Readiness
  router.get("/ready", async (_req: Request, res: Response) => {
    const checks: Record<string, string> = {};

    // Supabase check
    try {
      const url = process.env.SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (url && key) {
        checks.supabase = "ok";
      } else {
        checks.supabase = "missing_config";
      }
    } catch {
      checks.supabase = "error";
    }

    // Redis check
    try {
      const redisUrl = process.env.REDIS_URL;
      if (redisUrl) {
        checks.redis = "configured";
      } else {
        checks.redis = "not_configured";
      }
    } catch {
      checks.redis = "error";
    }

    const allOk = !Object.values(checks).some((v) => v === "error");
    res.status(allOk ? 200 : 503).json({
      status: allOk ? "ready" : "degraded",
      checks,
      version,
      timestamp: new Date().toISOString(),
    });
  });

  // Metrics placeholder (Phase 11.10)
  router.get("/metrics", (_req: Request, res: Response) => {
    res.set("Content-Type", "text/plain");
    res.send(
      [
        `# HELP nella_api_uptime_seconds Server uptime in seconds`,
        `# TYPE nella_api_uptime_seconds gauge`,
        `nella_api_uptime_seconds ${Math.floor((Date.now() - startedAt) / 1000)}`,
        `# HELP nella_api_info Server version info`,
        `# TYPE nella_api_info gauge`,
        `nella_api_info{version="${version}"} 1`,
      ].join("\n") + "\n"
    );
  });

  return router;
}
