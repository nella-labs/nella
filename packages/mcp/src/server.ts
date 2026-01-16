#!/usr/bin/env node
/**
 * Nella MCP Server
 *
 * Model Context Protocol server that exposes Nella's reliability layer
 * to AI agents like Claude.
 *
 * Usage:
 *   nella-mcp --workspace /path/to/project
 *   nella-mcp -w /path/to/project
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { ContextManager } from "@nella-labs/core";
import { parseArgs } from "./utils/args";
import { registerValidationTools, handleValidationTool } from "./tools/validation";
import { registerSafetyTools, handleSafetyTool } from "./tools/safety";
import { registerContextTools, handleContextTool } from "./tools/context";

// =============================================================================
// Types
// =============================================================================

export interface ServerContext {
  workspacePath: string;
  contextManager: ContextManager;
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  // Parse command line arguments
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.error(`
Nella MCP Server - Reliability layer for AI coding agents

Usage:
  nella-mcp --workspace <path>  Start server with workspace path
  nella-mcp -w <path>           Short form
  nella-mcp --help              Show this help

Options:
  -w, --workspace <path>   Path to the workspace/project directory (required)
  -h, --help               Show help message

Example:
  nella-mcp --workspace /home/user/my-project
`);
    process.exit(0);
  }

  if (!args.workspace) {
    console.error("Error: --workspace (-w) is required");
    console.error("Usage: nella-mcp --workspace /path/to/project");
    process.exit(1);
  }

  // Initialize context manager for stateful tracking
  const contextManager = new ContextManager(args.workspace);

  const serverContext: ServerContext = {
    workspacePath: args.workspace,
    contextManager,
  };

  // Create MCP server
  const server = new Server(
    {
      name: "nella",
      version: "0.2.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Collect all tools
  const allTools: Tool[] = [
    ...registerValidationTools(),
    ...registerSafetyTools(),
    ...registerContextTools(),
  ];

  // Handle tool listing
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: allTools };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const { name, arguments: args } = request.params;

    try {
      // Try each tool category
      const validationResult = await handleValidationTool(name, args || {}, serverContext);
      if (validationResult !== null) {
        return validationResult as CallToolResult;
      }

      const safetyResult = await handleSafetyTool(name, args || {}, serverContext);
      if (safetyResult !== null) {
        return safetyResult as CallToolResult;
      }

      const contextResult = await handleContextTool(name, args || {}, serverContext);
      if (contextResult !== null) {
        return contextResult as CallToolResult;
      }

      // Unknown tool
      return {
        content: [
          {
            type: "text",
            text: `Unknown tool: ${name}`,
          },
        ],
        isError: true,
      } as CallToolResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: `Error executing ${name}: ${message}`,
          },
        ],
        isError: true,
      } as CallToolResult;
    }
  });

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr (stdout is for MCP protocol)
  console.error(`Nella MCP server started for workspace: ${args.workspace}`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
