/**
 * Validation API
 *
 * POST /api/v1/validate/check    — Pre-flight safety check
 * POST /api/v1/validate/validate — Validate changes against constraints
 * POST /api/v1/validate/run      — Full validation run
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { ValidationService } from "@usenella/core/dist/services/validation-service";
import { SafetyService } from "@usenella/core/dist/services/safety-service";
import { sendSuccess, sendError } from "../utils/responses";
import { validateBody } from "../middleware/validation";
import { requireScope } from "../middleware/auth";
import { requirePlanFeature } from "../middleware/plan-gate";

// =============================================================================
// Schemas
// =============================================================================

const constraintSchema = z.object({
  id: z.string(),
  description: z.string(),
  rule: z.string(),
  filesNotToModify: z.array(z.string()).optional(),
  forbiddenPatterns: z.array(z.string()).optional(),
});

const checkSchema = z.object({
  workspaceId: z.string().min(1),
  taskId: z.string().min(1),
  prompt: z.string().min(1),
  skipPrerequisites: z.boolean().default(false),
});

const validateSchema = z.object({
  modifiedFiles: z.array(z.string()),
  diff: z.string(),
  constraints: z.array(constraintSchema),
});

const runSchema = z.object({
  workspaceId: z.string().min(1),
  taskId: z.string().min(1),
  taskName: z.string().min(1),
  prompt: z.string().min(1),
  constraints: z.array(constraintSchema).optional(),
  validation: z.object({
    test: z.string().optional(),
    lint: z.string().optional(),
    compile: z.string().optional(),
  }).optional(),
  expectedFiles: z.array(z.string()).optional(),
  changes: z.object({
    diff: z.string().optional(),
    files: z.array(z.object({
      path: z.string(),
      content: z.string(),
    })).optional(),
  }),
});

// =============================================================================
// Router
// =============================================================================

export function validateRouter(): Router {
  const router = Router();
  const validationService = new ValidationService();
  const safetyService = new SafetyService();

  // POST /api/v1/validate/check — Pre-flight safety check
  router.post("/check", requireScope("validate:run"), validateBody(checkSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId, taskId, prompt, skipPrerequisites } = req.body;

      // Run safety checks
      const refusal = await safetyService.shouldRefuse({
        taskId,
        prompt,
        workspacePath: workspaceId, // Will be resolved
        skipPrerequisites,
      });

      const risks = safetyService.detectRisks(prompt);

      sendSuccess(res, {
        safe: !refusal.shouldRefuse && !risks.hasRisks,
        refusal: {
          shouldRefuse: refusal.shouldRefuse,
          reason: refusal.reason,
          confidence: refusal.confidence,
        },
        risks: {
          patterns: risks.risks,
          count: risks.count,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/validate/validate — Check constraints (requires Starter+ for custom constraints)
  router.post("/validate", requireScope("validate:run"), requirePlanFeature("customConstraints"), validateBody(validateSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { modifiedFiles, diff, constraints } = req.body;

      const result = await validationService.checkConstraints({
        modifiedFiles,
        diff,
        constraints,
      });

      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/validate/run — Full validation run (requires Starter+ for custom constraints)
  router.post("/run", requireScope("validate:run"), requirePlanFeature("customConstraints"), validateBody(runSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await validationService.runFullTask({
        workspacePath: req.body.workspaceId, // Will be resolved from workspace registry
        ...req.body,
      });

      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
