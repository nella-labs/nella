/**
 * Standardized API Responses
 *
 * Consistent response shape for all endpoints:
 *   Success: { data, meta? }
 *   Error:   { error: { code, message, details?, requestId } }
 */

import type { Request, Response } from "express";

// ---------------------------------------------------------------------------
// Success responses
// ---------------------------------------------------------------------------

export interface ApiSuccessResponse<T = unknown> {
  data: T;
  meta?: Record<string, unknown>;
}

export function sendSuccess<T>(
  res: Response,
  data: T,
  meta?: Record<string, unknown>,
  statusCode = 200
): void {
  const body: ApiSuccessResponse<T> = { data };
  if (meta) body.meta = meta;
  res.status(statusCode).json(body);
}

export function sendCreated<T>(res: Response, data: T, meta?: Record<string, unknown>): void {
  sendSuccess(res, data, meta, 201);
}

export function sendNoContent(res: Response): void {
  res.status(204).end();
}

// ---------------------------------------------------------------------------
// Error responses
// ---------------------------------------------------------------------------

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId: string;
  };
}

export function sendError(
  res: Response,
  req: Request,
  statusCode: number,
  code: string,
  message: string,
  details?: unknown
): void {
  const body: ApiErrorBody = {
    error: {
      code,
      message,
      requestId: (req as any).requestId || "unknown",
      ...(details !== undefined && { details }),
    },
  };
  res.status(statusCode).json(body);
}
