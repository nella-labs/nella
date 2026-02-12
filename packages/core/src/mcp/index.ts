/**
 * MCP Module
 *
 * Model Context Protocol tools for nella.
 * Phase 7: Validation, caching, retry, timeouts, chaining,
 *           streaming, telemetry, versioning, metadata, new tools.
 */

// Types
export type {
  McpTool,
  McpToolParameter,
  McpToolCall,
  McpToolResult,
  SearchToolArgs,
  VerifyToolArgs,
  IndexToolArgs,
  GetContextToolArgs,
  SetContextToolArgs,
  ExplainToolArgs,
  DocsToolArgs,
  HistoryToolArgs,
  ToolCallMetadata,
  McpEvent,
  ToolCategory,
  ToolExample,
  ProgressCallback,
} from "./types";

export { NELLA_TOOLS } from "./types";

// Handler
export {
  McpToolHandler,
  createMcpToolHandler,
  type ToolHandlerConfig,
  type McpEventHandler,
} from "./handler";

// Validation
export {
  validateToolInput,
  assertValidToolInput,
  type ToolInputValidationResult,
} from "./validation";

// Errors
export {
  McpError,
  ToolValidationError,
  ToolTimeoutError,
  AuthenticationError,
  RateLimitError,
  ChainDepthError,
  UnknownToolError,
  RetryExhaustedError,
  type ValidationErrorDetail,
} from "./errors";

// Retry
export {
  retryWithBackoff,
  type RetryOptions,
  type RetryResult,
} from "./retry";

// Cache
export {
  ToolResultCache,
  type ToolResultCacheConfig,
} from "./cache";

// Telemetry
export {
  TelemetryManager,
  createTelemetryManager,
  type TelemetryConfig,
  type ToolSpan,
  type ToolMetrics,
} from "./telemetry";

// Registry
export {
  ToolRegistry,
  createToolRegistry,
  type ToolRegistryEntry,
  type ToolFilter,
} from "./registry";
