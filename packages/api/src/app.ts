/**
 * Express Application Setup
 *
 * Creates and configures the Express app with all middleware and routes.
 * Separated from server.ts for testability (supertest can import app directly).
 */

import express from "express";
import helmet from "helmet";
import compression from "compression";
import cors from "cors";
import crypto from "crypto";
import { getConfig } from "./config";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";
import { requestLogger } from "./middleware/logging";
import { healthRouter } from "./routes/health";
import { workspacesRouter } from "./routes/workspaces";
import { searchRouter } from "./routes/search";
import { validateRouter } from "./routes/validate";
import { contextRouter } from "./routes/context";
import { authRouter } from "./routes/auth";
import { apiKeyAuth } from "./middleware/auth";
import { createRateLimitMiddleware } from "./middleware/rate-limit";

export function createApp(): express.Application {
  const app = express();
  const config = getConfig();

  // ---------------------------------------------------------------------------
  // Security & Compression
  // ---------------------------------------------------------------------------
  app.use(helmet());
  app.use(compression());

  // ---------------------------------------------------------------------------
  // CORS — configurable origins, not wildcard
  // ---------------------------------------------------------------------------
  app.use(
    cors({
      origin: config.ALLOWED_ORIGINS,
      credentials: true,
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-API-Key", "X-Request-Id"],
      exposedHeaders: [
        "X-Request-Id",
        "X-RateLimit-Limit",
        "X-RateLimit-Remaining",
        "X-RateLimit-Reset",
        "Retry-After",
      ],
    })
  );

  // ---------------------------------------------------------------------------
  // Body Parsing
  // ---------------------------------------------------------------------------
  app.use(express.json({ limit: "5mb" }));
  app.use(express.urlencoded({ extended: true }));

  // ---------------------------------------------------------------------------
  // Request ID Tracking
  // ---------------------------------------------------------------------------
  app.use((req, _res, next) => {
    (req as any).requestId =
      (req.headers["x-request-id"] as string) || crypto.randomUUID();
    next();
  });

  // ---------------------------------------------------------------------------
  // Request Logging
  // ---------------------------------------------------------------------------
  app.use(requestLogger);

  // ---------------------------------------------------------------------------
  // Public Routes (no auth)
  // ---------------------------------------------------------------------------
  app.use("/", healthRouter());

  // ---------------------------------------------------------------------------
  // Protected Routes (API key required)
  // ---------------------------------------------------------------------------
  const protectedRouter = express.Router();
  protectedRouter.use(apiKeyAuth);
  protectedRouter.use(createRateLimitMiddleware());

  protectedRouter.use("/api/v1/workspaces", workspacesRouter());
  protectedRouter.use("/api/v1/search", searchRouter());
  protectedRouter.use("/api/v1/validate", validateRouter());
  protectedRouter.use("/api/v1/context", contextRouter());
  protectedRouter.use("/api/v1/auth", authRouter());

  app.use(protectedRouter);

  // ---------------------------------------------------------------------------
  // 404 + Error Handling
  // ---------------------------------------------------------------------------
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
