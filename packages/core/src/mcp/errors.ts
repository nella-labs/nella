/**
 * MCP Error Classes
 *
 * Custom error types for the MCP tool handler.
 */

// =============================================================================
// Base Error
// =============================================================================

export class McpError extends Error {
  public readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "McpError";
    this.code = code;
  }
}

// =============================================================================
// Validation Error
// =============================================================================

export interface ValidationErrorDetail {
  field: string;
  message: string;
  expected?: string;
  received?: unknown;
}

export class ToolValidationError extends McpError {
  public readonly errors: ValidationErrorDetail[];

  constructor(toolName: string, errors: ValidationErrorDetail[]) {
    const summary = errors.map((e) => `  - ${e.field}: ${e.message}`).join("\n");
    super(
      `Invalid arguments for tool "${toolName}":\n${summary}`,
      "VALIDATION_ERROR",
    );
    this.name = "ToolValidationError";
    this.errors = errors;
  }
}

// =============================================================================
// Timeout Error
// =============================================================================

export class ToolTimeoutError extends McpError {
  public readonly toolName: string;
  public readonly timeoutMs: number;

  constructor(toolName: string, timeoutMs: number) {
    super(
      `Tool "${toolName}" timed out after ${timeoutMs}ms`,
      "TIMEOUT_ERROR",
    );
    this.name = "ToolTimeoutError";
    this.toolName = toolName;
    this.timeoutMs = timeoutMs;
  }
}

// =============================================================================
// Authentication Error
// =============================================================================

export class AuthenticationError extends McpError {
  constructor(message: string) {
    super(message, "AUTH_ERROR");
    this.name = "AuthenticationError";
  }
}

// =============================================================================
// Rate Limit Error
// =============================================================================

export class RateLimitError extends McpError {
  public readonly retryAfter?: number;

  constructor(message: string, retryAfter?: number) {
    super(message, "RATE_LIMIT_ERROR");
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
  }
}

// =============================================================================
// Chain Depth Error
// =============================================================================

export class ChainDepthError extends McpError {
  public readonly depth: number;
  public readonly maxDepth: number;

  constructor(depth: number, maxDepth: number) {
    super(
      `Tool chain depth ${depth} exceeds maximum of ${maxDepth}`,
      "CHAIN_DEPTH_ERROR",
    );
    this.name = "ChainDepthError";
    this.depth = depth;
    this.maxDepth = maxDepth;
  }
}

// =============================================================================
// Unknown Tool Error
// =============================================================================

export class UnknownToolError extends McpError {
  public readonly toolName: string;

  constructor(toolName: string) {
    super(`Unknown tool: ${toolName}`, "UNKNOWN_TOOL");
    this.name = "UnknownToolError";
    this.toolName = toolName;
  }
}

// =============================================================================
// Retry Exhausted Error
// =============================================================================

export class RetryExhaustedError extends McpError {
  public readonly attempts: number;
  public readonly lastError: Error;

  constructor(attempts: number, lastError: Error) {
    super(
      `All ${attempts} retry attempts exhausted. Last error: ${lastError.message}`,
      "RETRY_EXHAUSTED",
    );
    this.name = "RetryExhaustedError";
    this.attempts = attempts;
    this.lastError = lastError;
  }
}
