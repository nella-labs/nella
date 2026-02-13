/**
 * Custom Error Classes
 *
 * Typed errors for the API layer. Each carries an HTTP status code
 * and a machine-readable error code for clients.
 */

export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends ApiError {
  constructor(message: string, details?: unknown) {
    super(400, "VALIDATION_ERROR", message, details);
    this.name = "ValidationError";
  }
}

export class AuthenticationError extends ApiError {
  constructor(message = "Invalid or missing authentication") {
    super(401, "AUTHENTICATION_ERROR", message);
    this.name = "AuthenticationError";
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = "Insufficient permissions") {
    super(403, "FORBIDDEN", message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends ApiError {
  constructor(resource: string, id?: string) {
    const msg = id ? `${resource} '${id}' not found` : `${resource} not found`;
    super(404, "NOT_FOUND", msg);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends ApiError {
  constructor(message: string) {
    super(409, "CONFLICT", message);
    this.name = "ConflictError";
  }
}

export class RateLimitError extends ApiError {
  public readonly retryAfter: number;

  constructor(retryAfterSeconds: number) {
    super(429, "RATE_LIMIT_EXCEEDED", "Too many requests");
    this.name = "RateLimitError";
    this.retryAfter = retryAfterSeconds;
  }
}

export class InternalError extends ApiError {
  constructor(message = "Internal server error") {
    super(500, "INTERNAL_ERROR", message);
    this.name = "InternalError";
  }
}
