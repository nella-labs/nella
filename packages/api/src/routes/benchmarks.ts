/**
 * Benchmarks API
 *
 * Stores and retrieves benchmark results for feature metrics dashboards.
 * GET  /latest  — Latest result for a feature
 * GET  /history — Historical results for a feature
 * POST /        — Insert new benchmark result (admin scope)
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { sendSuccess, sendCreated, sendError } from "../utils/responses";
import { validateBody } from "../middleware/validation";
import { requireScope } from "../middleware/auth";
import { log } from "../utils/logger";

// =============================================================================
// Schemas
// =============================================================================

const createBenchmarkSchema = z.object({
  feature: z.string().min(1),
  version: z.string().min(1),
  corpus_stats: z.record(z.unknown()),
  headline: z.record(z.unknown()),
  by_category: z.array(z.record(z.unknown())),
  by_difficulty: z.array(z.record(z.unknown())),
  by_layer: z.array(z.record(z.unknown())),
  raw_results_url: z.string().url().optional(),
});

// =============================================================================
// Supabase helper
// =============================================================================

let supabaseClient: any = null;

function getSupabase() {
  if (supabaseClient) return supabaseClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const { createClient } = require("@supabase/supabase-js");
  supabaseClient = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return supabaseClient;
}

// =============================================================================
// Router
// =============================================================================

export function benchmarksRouter(): Router {
  const router = Router();

  // GET /api/v1/benchmarks/latest?feature=prompt-injection-defense
  router.get("/latest", requireScope("benchmarks:read"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const feature = req.query.feature as string | undefined;
      if (!feature) {
        sendError(res, req, 400, "VALIDATION_ERROR", "Query parameter 'feature' is required");
        return;
      }

      const supabase = getSupabase();
      if (!supabase) {
        sendError(res, req, 503, "SERVICE_UNAVAILABLE", "Database not configured");
        return;
      }

      const { data, error } = await supabase
        .from("benchmark_results")
        .select("*")
        .eq("feature", feature)
        .order("run_date", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        log("error", "Failed to fetch latest benchmark", { feature, error: error.message });
        sendError(res, req, 500, "DATABASE_ERROR", "Failed to fetch benchmark result");
        return;
      }

      if (!data) {
        sendError(res, req, 404, "NOT_FOUND", `No benchmark results found for feature '${feature}'`);
        return;
      }

      sendSuccess(res, data);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/benchmarks/history?feature=prompt-injection-defense&limit=10
  router.get("/history", requireScope("benchmarks:read"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const feature = req.query.feature as string | undefined;
      if (!feature) {
        sendError(res, req, 400, "VALIDATION_ERROR", "Query parameter 'feature' is required");
        return;
      }

      const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 10, 1), 100);

      const supabase = getSupabase();
      if (!supabase) {
        sendError(res, req, 503, "SERVICE_UNAVAILABLE", "Database not configured");
        return;
      }

      const { data, error } = await supabase
        .from("benchmark_results")
        .select("*")
        .eq("feature", feature)
        .order("run_date", { ascending: false })
        .limit(limit);

      if (error) {
        log("error", "Failed to fetch benchmark history", { feature, error: error.message });
        sendError(res, req, 500, "DATABASE_ERROR", "Failed to fetch benchmark history");
        return;
      }

      sendSuccess(res, data ?? []);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/benchmarks — Insert new benchmark result (admin scope)
  router.post("/", requireScope("admin"), validateBody(createBenchmarkSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const supabase = getSupabase();
      if (!supabase) {
        sendError(res, req, 503, "SERVICE_UNAVAILABLE", "Database not configured");
        return;
      }

      const { data, error } = await supabase
        .from("benchmark_results")
        .insert({
          feature: req.body.feature,
          version: req.body.version,
          corpus_stats: req.body.corpus_stats,
          headline: req.body.headline,
          by_category: req.body.by_category,
          by_difficulty: req.body.by_difficulty,
          by_layer: req.body.by_layer,
          raw_results_url: req.body.raw_results_url ?? null,
          created_by: req.user?.userId ?? null,
        })
        .select()
        .single();

      if (error) {
        log("error", "Failed to insert benchmark result", { error: error.message });
        sendError(res, req, 500, "DATABASE_ERROR", "Failed to insert benchmark result");
        return;
      }

      log("info", "Benchmark result created", {
        id: data.id,
        feature: data.feature,
        version: data.version,
        userId: req.user?.userId,
      });

      sendCreated(res, data);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
