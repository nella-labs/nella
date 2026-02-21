/**
 * Workspaces API
 *
 * CRUD + index trigger + sync trigger for workspaces.
 * All routes require authentication and workspaces:read or workspaces:write scope.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { WorkspaceService } from "@usenella/core/dist/services/workspace-service";
import { sendSuccess, sendCreated, sendNoContent, sendError } from "../utils/responses";
import { parsePagination, decodeCursor, buildPaginationMeta } from "../utils/pagination";
import { validateBody } from "../middleware/validation";
import { requireScope } from "../middleware/auth";
import { checkWorkspacePlanLimit } from "../middleware/plan-gate";
import { log } from "../utils/logger";

// =============================================================================
// Schemas
// =============================================================================

const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(255),
  path: z.string().min(1),
  config: z.record(z.unknown()).optional(),
});

const updateWorkspaceSchema = z.object({
  config: z.record(z.unknown()).optional(),
  name: z.string().min(1).max(255).optional(),
});

// =============================================================================
// Router
// =============================================================================

export function workspacesRouter(): Router {
  const router = Router();
  const service = new WorkspaceService();

  // GET /api/v1/workspaces
  router.get("/", requireScope("workspaces:read"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { cursor, limit } = parsePagination(req.query);
      const offset = decodeCursor(cursor);
      const result = await service.list(offset, limit);
      const meta = buildPaginationMeta(offset, limit, result.workspaces.length, result.total);
      sendSuccess(res, result.workspaces, { ...meta });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/workspaces — workspace creation gated by plan limit
  router.post("/", requireScope("workspaces:write"), checkWorkspacePlanLimit, validateBody(createWorkspaceSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ws = await service.create(req.body);
      log("info", "Workspace created", { workspaceId: ws.id, userId: req.user?.userId });
      sendCreated(res, ws);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/workspaces/:id
  router.get("/:id", requireScope("workspaces:read"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ws = await service.getById(req.params.id);
      if (!ws) {
        sendError(res, req, 404, "NOT_FOUND", `Workspace '${req.params.id}' not found`);
        return;
      }
      sendSuccess(res, ws);
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/v1/workspaces/:id
  router.patch("/:id", requireScope("workspaces:write"), validateBody(updateWorkspaceSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ws = await service.update(req.params.id, req.body.config || {});
      if (!ws) {
        sendError(res, req, 404, "NOT_FOUND", `Workspace '${req.params.id}' not found`);
        return;
      }
      sendSuccess(res, ws);
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/v1/workspaces/:id
  router.delete("/:id", requireScope("workspaces:write"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const removed = await service.remove(req.params.id);
      if (!removed) {
        sendError(res, req, 404, "NOT_FOUND", `Workspace '${req.params.id}' not found`);
        return;
      }
      log("info", "Workspace removed", { workspaceId: req.params.id, userId: req.user?.userId });
      sendNoContent(res);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/workspaces/:id/index — trigger async indexing
  router.post("/:id/index", requireScope("workspaces:write"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ws = await service.getById(req.params.id);
      if (!ws) {
        sendError(res, req, 404, "NOT_FOUND", `Workspace '${req.params.id}' not found`);
        return;
      }
      // TODO: Enqueue via BullMQ job queue (Phase 11.6)
      log("info", "Index triggered", { workspaceId: req.params.id, userId: req.user?.userId });
      sendSuccess(res, {
        workspaceId: req.params.id,
        status: "queued",
        message: "Indexing job has been queued",
      }, undefined, 202);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/workspaces/:id/index/status
  router.get("/:id/index/status", requireScope("workspaces:read"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ws = await service.getById(req.params.id);
      if (!ws) {
        sendError(res, req, 404, "NOT_FOUND", `Workspace '${req.params.id}' not found`);
        return;
      }
      sendSuccess(res, {
        workspaceId: req.params.id,
        indexed: ws.indexed,
        indexStatus: ws.indexStatus,
        fileCount: ws.fileCount || 0,
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/workspaces/:id/sync — trigger cloud sync
  router.post("/:id/sync", requireScope("workspaces:write"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ws = await service.getById(req.params.id);
      if (!ws) {
        sendError(res, req, 404, "NOT_FOUND", `Workspace '${req.params.id}' not found`);
        return;
      }
      // TODO: Enqueue via BullMQ job queue (Phase 11.6)
      log("info", "Sync triggered", { workspaceId: req.params.id, userId: req.user?.userId });
      sendSuccess(res, {
        workspaceId: req.params.id,
        status: "queued",
        message: "Sync job has been queued",
      }, undefined, 202);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
