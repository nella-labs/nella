/**
 * Nella MCP Server
 *
 * Model Context Protocol server that exposes Nella's codebase intelligence
 * to AI agents. This package provides the MCP interface - the actual
 * logic lives in @nella-labs/core.
 *
 * @packageDocumentation
 */

// Re-export server context type for extension
export type { ServerContext } from "./server";

// Re-export the server start function
export { startMcpServer } from "./server";

// Re-export the hosted (HTTP) server
export { startHostedServer } from "./hosted-server";

// Re-export tool registration for custom servers
export {
  registerContextTools,
  handleContextTool,
} from "./tools";
