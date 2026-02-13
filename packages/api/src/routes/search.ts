/**
 * Search API
 *
 * POST /api/v1/search       — Hybrid search
 * POST /api/v1/search/batch — Batch search
 * POST /api/v1/verify       — Code verification
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { SearchService } from "@usenella/core/dist/services/search-service";
import { sendSuccess, sendError } from "../utils/responses";
import { validateBody } from "../middleware/validation";
import { requireScope } from "../middleware/auth";

// =============================================================================
// Schemas
// =============================================================================

const searchSchema = z.object({
  workspaceId: z.string().min(1),
  query: z.string().min(1),
  mode: z.enum(["hybrid", "semantic", "lexical"]).default("hybrid"),
  topK: z.number().int().min(1).max(100).default(10),
  filters: z.object({
    language: z.string().optional(),
    filePattern: z.string().optional(),
  }).optional(),
});

const batchSearchSchema = z.object({
  workspaceId: z.string().min(1),
  queries: z.array(z.object({
    query: z.string().min(1),
    mode: z.enum(["hybrid", "semantic", "lexical"]).default("hybrid"),
    topK: z.number().int().min(1).max(100).default(10),
  })).min(1).max(20),
});

const verifySchema = z.object({
  workspaceId: z.string().min(1),
  code: z.string().min(1),
  checkImports: z.boolean().default(true),
  checkSymbols: z.boolean().default(true),
});

// =============================================================================
// Router
// =============================================================================

export function searchRouter(): Router {
  const router = Router();
  const service = new SearchService();

  // POST /api/v1/search
  router.post("/", requireScope("search:read"), validateBody(searchSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId, query, mode, topK, filters } = req.body;

      const config = {
        workspacePath: "", // Will be resolved from workspace registry
        storagePath: "",   // Will be resolved from workspace registry
      };

      const result = await service.search(
        { workspaceId, query, mode, topK, filters },
        config
      );

      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/search/batch
  router.post("/batch", requireScope("search:read"), validateBody(batchSearchSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId, queries } = req.body;

      const config = {
        workspacePath: "",
        storagePath: "",
      };

      const results = await Promise.all(
        queries.map((q: any) =>
          service.search(
            { workspaceId, query: q.query, mode: q.mode, topK: q.topK },
            config
          )
        )
      );

      sendSuccess(res, { results });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/verify
  router.post(
    "/verify",
    requireScope("search:read"),
    validateBody(verifySchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId, code, checkImports, checkSymbols } = req.body;

        const config = {
          workspacePath: "",
          storagePath: "",
        };

        const result = await service.verifyCode(workspaceId, code, config, {
          checkImports,
          checkSymbols,
        });

        sendSuccess(res, result);
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
