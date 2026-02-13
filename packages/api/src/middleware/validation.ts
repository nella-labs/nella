/**
 * Request Validation Middleware
 *
 * Zod schema validation for request body, query, and params.
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { sendError } from "../utils/responses";

/**
 * Validate request body against a Zod schema.
 */
export function validateBody<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      sendError(res, req, 400, "VALIDATION_ERROR", "Request body validation failed", result.error.issues);
      return;
    }
    req.body = result.data;
    next();
  };
}

/**
 * Validate query parameters against a Zod schema.
 */
export function validateQuery<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      sendError(res, req, 400, "VALIDATION_ERROR", "Query parameter validation failed", result.error.issues);
      return;
    }
    req.query = result.data;
    next();
  };
}

/**
 * Validate URL params against a Zod schema.
 */
export function validateParams<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      sendError(res, req, 400, "VALIDATION_ERROR", "URL parameter validation failed", result.error.issues);
      return;
    }
    req.params = result.data as any;
    next();
  };
}
