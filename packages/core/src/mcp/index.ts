/**
 * MCP Module
 *
 * Model Context Protocol tools for nella.
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
  ToolCallMetadata,
  McpEvent,
} from "./types";

export { NELLA_TOOLS } from "./types";

// Handler
export {
  McpToolHandler,
  createMcpToolHandler,
  type ToolHandlerConfig,
  type McpEventHandler,
} from "./handler";
