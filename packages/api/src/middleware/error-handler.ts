/**
 * Error Handler Middleware
 *
 * Global Express error handler producing standardized error responses.
 */

import type { Request, Response, NextFunction } from "express";
import { ApiError } from "../utils/errors";
import { log } from "../utils/logger";

/**
 * 404 handler — must be registered before the error handler.
 */
export function notFoundHandler(req: Request, res: Response, _next: NextFunction): void {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: `Route ${req.method} ${req.path} not found`,
      requestId: (req as any).requestId || "unknown",
    },
  });
}

/**
 * Global error handler.
 */
export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  const requestId = (req as any).requestId || "unknown";

  if (err instanceof ApiError) {
    log("warn", `API Error: ${err.code} ${err.message}`, {
      requestId,
      statusCode: err.statusCode,
      code: err.code,
    });

    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined && { details: err.details }),
        requestId,
      },
    });
    return;
  }

  // Zod validation errors
  if (err.name === "ZodError") {
    const zodErr = err as any;
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: zodErr.issues,
        requestId,
      },
    });
    return;
  }

  // JSON parse errors
  if ((err as any).type === "entity.parse.failed") {
    res.status(400).json({
      error: {
        code: "INVALID_JSON",
        message: "Request body contains invalid JSON",
        requestId,
      },
    });
    return;
  }

  // Unexpected errors
  log("error", `Unhandled error: ${err.message}`, {
    requestId,
    stack: err.stack,
  });

  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: process.env.NODE_ENV === "production"
        ? "Internal server error"
        : err.message,
      requestId,
    },
  });
}
