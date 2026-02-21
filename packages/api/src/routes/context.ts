/**
 * Context API
 *
 * CRUD for context entries, channels, sessions.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { ContextManager } from "@usenella/core";
import { ContextService } from "@usenella/core/dist/services/context-service";
import { sendSuccess, sendCreated, sendNoContent, sendError } from "../utils/responses";
import { validateBody } from "../middleware/validation";
import { requireScope } from "../middleware/auth";
import { requirePlanFeature } from "../middleware/plan-gate";

// =============================================================================
// Schemas
// =============================================================================

const setContextSchema = z.object({
  key: z.string().min(1),
  value: z.unknown(),
  type: z.enum(["schema", "interface", "dependency", "behavior", "config", "structure", "other"]).default("other"),
  relatedFiles: z.array(z.string()).optional(),
});

const addAssumptionSchema = z.object({
  type: z.enum(["schema", "interface", "dependency", "behavior", "config", "structure", "other"]),
  description: z.string().min(1),
  relatedFiles: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1).default(0.8),
});

const recordChangeSchema = z.object({
  files: z.array(z.string()).min(1),
  operation: z.enum(["create", "modify", "delete"]).default("modify"),
  reason: z.string().min(1),
});

// =============================================================================
// Context managers per workspace (cached)
// =============================================================================

const contextManagers = new Map<string, ContextService>();

function getContextService(workspacePath: string): ContextService {
  let service = contextManagers.get(workspacePath);
  if (!service) {
    const cm = new ContextManager(workspacePath);
    service = new ContextService(cm);
    contextManagers.set(workspacePath, service);
  }
  return service;
}

// =============================================================================
// Router
// =============================================================================

export function contextRouter(): Router {
  const router = Router();

  // All context routes require Starter+ plan (contextTracking feature)

  // GET /api/v1/context?workspaceId=xxx
  router.get("/", requireScope("context:read"), requirePlanFeature("contextTracking"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.query.workspaceId as string;
      if (!workspaceId) {
        sendError(res, req, 400, "VALIDATION_ERROR", "workspaceId query parameter is required");
        return;
      }
      const service = getContextService(workspaceId);
      const limit = Number(req.query.limit) || 20;
      const context = service.getContext(limit);
      sendSuccess(res, context);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/context/assumptions
  router.post("/assumptions", requireScope("context:write"), requirePlanFeature("contextTracking"), validateBody(addAssumptionSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.query.workspaceId as string || req.body.workspaceId;
      if (!workspaceId) {
        sendError(res, req, 400, "VALIDATION_ERROR", "workspaceId is required");
        return;
      }
      const service = getContextService(workspaceId);
      const assumption = await service.addAssumption(req.body);
      sendCreated(res, assumption);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/context/assumptions
  router.get("/assumptions", requireScope("context:read"), requirePlanFeature("contextTracking"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.query.workspaceId as string;
      if (!workspaceId) {
        sendError(res, req, 400, "VALIDATION_ERROR", "workspaceId query parameter is required");
        return;
      }
      const service = getContextService(workspaceId);
      const status = service.getAssumptionStatus();
      sendSuccess(res, status);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/context/files/:filePath — file history
  router.get("/files/*", requireScope("context:read"), requirePlanFeature("contextTracking"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.query.workspaceId as string;
      if (!workspaceId) {
        sendError(res, req, 400, "VALIDATION_ERROR", "workspaceId query parameter is required");
        return;
      }
      const filePath = req.params[0]; // Everything after /files/
      const service = getContextService(workspaceId);
      const history = service.getFileHistory(filePath);
      sendSuccess(res, history);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/context/dependencies
  router.get("/dependencies", requireScope("context:read"), requirePlanFeature("contextTracking"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.query.workspaceId as string;
      if (!workspaceId) {
        sendError(res, req, 400, "VALIDATION_ERROR", "workspaceId query parameter is required");
        return;
      }
      const service = getContextService(workspaceId);
      const diff = service.checkDependencies(workspaceId);
      sendSuccess(res, diff || { added: [], removed: [], updated: [] });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/context/changes — record file changes
  router.post("/changes", requireScope("context:write"), requirePlanFeature("contextTracking"), validateBody(recordChangeSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.query.workspaceId as string || req.body.workspaceId;
      if (!workspaceId) {
        sendError(res, req, 400, "VALIDATION_ERROR", "workspaceId is required");
        return;
      }
      const service = getContextService(workspaceId);
      const result = await service.recordChanges(req.body);
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/context/sessions
  router.get("/sessions", requireScope("context:read"), requirePlanFeature("contextTracking"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Return list of active context sessions
      const sessions = Array.from(contextManagers.keys()).map((wsPath) => ({
        workspacePath: wsPath,
        active: true,
      }));
      sendSuccess(res, sessions);
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/v1/context/sessions/:workspaceId
  router.delete("/sessions/:workspaceId", requireScope("context:write"), requirePlanFeature("contextTracking"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.params.workspaceId;
      if (contextManagers.has(workspaceId)) {
        contextManagers.delete(workspaceId);
      }
      sendNoContent(res);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
