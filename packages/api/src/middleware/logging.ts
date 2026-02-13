/**
 * Request Logging Middleware
 *
 * Structured JSON request/response logging with duration tracking.
 */

import type { Request, Response, NextFunction } from "express";
import { log } from "../utils/logger";

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  // Log on response finish
  res.on("finish", () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";

    log(level, `${req.method} ${req.path} ${res.statusCode} ${duration}ms`, {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration,
      requestId: (req as any).requestId,
      userId: req.user?.userId,
      userAgent: req.headers["user-agent"],
      ip: req.ip,
    });
  });

  next();
}
