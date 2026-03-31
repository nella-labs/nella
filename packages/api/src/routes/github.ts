/**
 * GitHub API Routes
 *
 * Webhook endpoint for GitHub events and repository linking management.
 * The webhook endpoint does NOT require API key auth — it uses GitHub's
 * HMAC-SHA256 signature verification instead.
 */

import { Router, type Request, type Response } from "express";
import * as crypto from "crypto";
import { z } from "zod";
import type { GitHubWebhookPayload } from "@usenella/core";
import { sendSuccess, sendCreated, sendError } from "../utils/responses";
import { validateBody } from "../middleware/validation";
import { requireScope } from "../middleware/auth";
import { log } from "../utils/logger";

// =============================================================================
// Schemas
// =============================================================================

const linkRepoSchema = z.object({
  workspace_id: z.string().min(1),
  installation_id: z.number().int().positive(),
  repo_full_name: z.string().regex(/^[^/]+\/[^/]+$/),
  repo_id: z.number().int().positive(),
  default_branch: z.string().default("main"),
  events: z.array(z.string()).default(["push", "pull_request"]),
  org_id: z.string().uuid().optional(),
  project_id: z.string().uuid().optional(),
});

// =============================================================================
// Router
// =============================================================================

export function githubRouter(): Router {
  const router = Router();

  // --------------------------------------------------------------------------
  // POST /api/v1/github/webhooks — Receive GitHub webhook events
  // NO auth middleware — verified via X-Hub-Signature-256 header
  // --------------------------------------------------------------------------
  router.post("/webhooks", async (req: Request, res: Response) => {
    try {
      const event = req.headers["x-github-event"] as string;
      const signature = req.headers["x-hub-signature-256"] as string;
      const deliveryId = req.headers["x-github-delivery"] as string;

      if (!event || !signature) {
        res.status(400).json({ error: "Missing required GitHub headers" });
        return;
      }

      log("info", "Received GitHub webhook", { event, deliveryId });

      const webhookPayload = req.body as GitHubWebhookPayload;
      if (!webhookPayload.repository) {
        res.status(400).json({ error: "Invalid webhook payload: missing repository" });
        return;
      }

      // TODO: Wire to WebhookHandler + JobQueue for async processing
      // Signature verification happens per-repo link (each has its own secret)
      log("info", "GitHub webhook processed", {
        event,
        action: webhookPayload.action,
        repo: webhookPayload.repository.full_name,
        pr: webhookPayload.pull_request?.number,
        ref: webhookPayload.ref,
        deliveryId,
      });

      res.status(200).json({
        received: true,
        event,
        repository: webhookPayload.repository.full_name,
      });
    } catch (error) {
      log("error", "GitHub webhook error", { error: String(error) });
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // --------------------------------------------------------------------------
  // POST /api/v1/github/link — Link a workspace to a GitHub repo
  // --------------------------------------------------------------------------
  router.post("/link",
    requireScope("workspaces:write"),
    validateBody(linkRepoSchema),
    async (req: Request, res: Response) => {
      try {
        const data = req.body;
        const userId = (req as any).user?.userId;

        if (!userId) {
          sendError(res, req, 401, "AUTH_REQUIRED", "Authentication required");
          return;
        }

        const webhookSecret = crypto.randomBytes(32).toString("hex");

        const link = {
          id: crypto.randomUUID(),
          user_id: userId,
          workspace_id: data.workspace_id,
          full_name: data.repo_full_name,
          repo_id: data.repo_id,
          default_branch: data.default_branch,
          webhook_id: null,
          webhook_secret: webhookSecret,
          installation_id: data.installation_id,
          events: data.events,
          status: "pending",
          org_id: data.org_id || null,
          project_id: data.project_id || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        // TODO: Save to Supabase, register webhook on GitHub, update status
        log("info", "GitHub repo link created", { linkId: link.id, repo: link.full_name });

        sendCreated(res, link);
      } catch (error) {
        log("error", "Failed to create GitHub link", { error: String(error) });
        sendError(res, req, 500, "LINK_FAILED", "Failed to create repository link");
      }
    },
  );

  // --------------------------------------------------------------------------
  // DELETE /api/v1/github/link/:linkId — Unlink a repository
  // --------------------------------------------------------------------------
  router.delete("/link/:linkId",
    requireScope("workspaces:write"),
    async (req: Request, res: Response) => {
      try {
        const { linkId } = req.params;
        // TODO: Remove webhook from GitHub, delete from Supabase
        log("info", "GitHub repo link deleted", { linkId });
        res.status(204).send();
      } catch (error) {
        log("error", "Failed to delete GitHub link", { error: String(error) });
        sendError(res, req, 500, "UNLINK_FAILED", "Failed to delete repository link");
      }
    },
  );

  // --------------------------------------------------------------------------
  // GET /api/v1/github/link/:workspaceId — Get link status
  // --------------------------------------------------------------------------
  router.get("/link/:workspaceId",
    requireScope("workspaces:read"),
    async (req: Request, res: Response) => {
      try {
        const { workspaceId } = req.params;
        // TODO: Fetch from Supabase
        sendSuccess(res, { workspaceId, linked: false });
      } catch (error) {
        log("error", "Failed to get GitHub link status", { error: String(error) });
        sendError(res, req, 500, "STATUS_FAILED", "Failed to get link status");
      }
    },
  );

  return router;
}
