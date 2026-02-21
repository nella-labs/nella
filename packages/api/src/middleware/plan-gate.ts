/**
 * Plan Feature Gating Middleware
 *
 * Enforces subscription-tier feature access on nella core API routes.
 * When the user's API key is linked to an org, we check the org's plan.
 * When no plan info is available (self-hosted / unlinked key), all features
 * are allowed by default.
 */

import type { Request, Response, NextFunction } from "express";
import { sendError } from "../utils/responses";
import type { PlanFeatures, SearchTier } from "./auth";

/**
 * Middleware factory: require a boolean plan feature.
 *
 * Usage:
 *   router.post("/verify", requirePlanFeature("codeVerification"), handler)
 */
export function requirePlanFeature(feature: keyof PlanFeatures) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // No plan info → self-hosted / unlinked key → allow everything
    if (!req.user?.planFeatures) {
      next();
      return;
    }

    const value = req.user.planFeatures[feature];
    if (value) {
      next();
      return;
    }

    sendError(
      res,
      req,
      403,
      "FEATURE_NOT_AVAILABLE",
      `Your plan (${req.user.planSlug ?? "free"}) does not include this feature. Upgrade at https://getnella.dev/dashboard/usage`
    );
  };
}

/**
 * Middleware factory: require a minimum search tier.
 *
 * Usage:
 *   router.post("/search", requireSearchTier("advanced"), handler)
 */
export function requireSearchTier(minTier: "advanced" | "premium") {
  const tierOrder: Record<SearchTier, number> = { basic: 0, advanced: 1, premium: 2 };

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user?.planFeatures) {
      next();
      return;
    }

    const current = req.user.planFeatures.searchTier;
    if (tierOrder[current] >= tierOrder[minTier]) {
      next();
      return;
    }

    sendError(
      res,
      req,
      403,
      "FEATURE_NOT_AVAILABLE",
      `Your plan only includes ${current} search. Upgrade for ${minTier} search capabilities.`
    );
  };
}

/**
 * Middleware factory: check workspace quota before creation.
 *
 * Usage:
 *   router.post("/workspaces", checkWorkspacePlanLimit, handler)
 */
export function checkWorkspacePlanLimit(req: Request, res: Response, next: NextFunction): void {
  if (!req.user?.planLimits) {
    next();
    return;
  }

  const limit = req.user.planLimits.workspaces;

  // 0 = no workspaces allowed on this plan
  if (limit === 0) {
    sendError(
      res,
      req,
      403,
      "QUOTA_EXCEEDED",
      `Your plan (${req.user.planSlug ?? "free"}) does not include workspaces. Upgrade to create workspaces.`
    );
    return;
  }

  // -1 = unlimited
  // For positive limits, we'd ideally check the current count, but that requires
  // an async DB call. The actual count-based check is done at the nella-website
  // proxy layer (checkWorkspaceQuota). This middleware blocks the hard-zero case.
  next();
}
