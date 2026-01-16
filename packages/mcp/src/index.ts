/**
 * Nella MCP Server
 *
 * Model Context Protocol server that exposes Nella's reliability layer
 * to AI agents. This package provides the MCP interface - the actual
 * logic lives in @nella-labs/core.
 *
 * @packageDocumentation
 */

// Re-export server context type for extension
export type { ServerContext } from "./server";

// Re-export tool registration for custom servers
export {
  registerValidationTools,
  handleValidationTool,
  registerSafetyTools,
  handleSafetyTool,
  registerContextTools,
  handleContextTool,
} from "./tools";
