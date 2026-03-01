#!/usr/bin/env node
/**
 * Nella MCP Server
 *
 * Model Context Protocol server that exposes Nella's reliability layer
 * to AI agents like Claude.
 *
 * Usage:
 *   npx @getnella/mcp                              # auto-start via npx
 *   npx @getnella/mcp --workspace /path/to/project  # with explicit workspace
 *   nella mcp --workspace /path/to/project           # via CLI subcommand
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { ContextManager } from "@usenella/core";
import { parseWorkspaceArg } from "./utils/args";
import { registerValidationTools, handleValidationTool } from "./tools/validation";
import { registerSafetyTools, handleSafetyTool } from "./tools/safety";
import { registerContextTools, handleContextTool } from "./tools/context";
import { registerCodeTools, handleCodeTool } from "./tools/code";

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

export async function startMcpServer(args: { workspace?: string; help?: boolean }): Promise<void> {
  if (args.help) {
    console.error(`
Nella MCP Server - Reliability layer for AI coding agents

Usage:
  nella mcp --workspace <path>  Start server with workspace path
  nella mcp -w <path>           Short form
  nella mcp --help              Show this help

Options:
  -w, --workspace <path>   Path to the workspace/project directory (required)
  -h, --help               Show help message

Example:
  nella mcp --workspace /home/user/my-project
`);
    process.exit(0);
  }

  if (!args.workspace) {
    console.error("Error: --workspace (-w) is required");
    console.error("Usage: nella mcp --workspace /path/to/project");
    process.exit(1);
  }

  const workspacePath = args.workspace!;

  // Initialize context manager for stateful tracking
  const contextManager = new ContextManager(workspacePath);

  const serverContext: ServerContext = {
    workspacePath,
    contextManager,
  };

  // Create MCP server
  const server = new Server(
    {
      name: "nella",
      version: "0.0.0",
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
    ...registerCodeTools(),
  ];

  // Handle tool listing
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: allTools };
  });

  // Handle tool calls
  server.setRequestHandler(
    CallToolRequestSchema,
    async (request: { params: { name: string; arguments?: Record<string, unknown> } }): Promise<CallToolResult> => {
      const { name, arguments: toolArgs } = request.params;
      try {
        // Try each tool category
        const validationResult = await handleValidationTool(name, toolArgs || {}, serverContext);
        if (validationResult !== null) {
          return validationResult as CallToolResult;
        }

        const safetyResult = await handleSafetyTool(name, toolArgs || {}, serverContext);
        if (safetyResult !== null) {
          return safetyResult as CallToolResult;
        }

        const contextResult = await handleContextTool(name, toolArgs || {}, serverContext);
        if (contextResult !== null) {
          return contextResult as CallToolResult;
        }

        const codeResult = await handleCodeTool(name, toolArgs || {}, serverContext);
        if (codeResult !== null) {
          return codeResult as CallToolResult;
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
    }
  );

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr (stdout is for MCP protocol)
  console.error(`Nella MCP server started for workspace: ${workspacePath}`);
}

// If run directly (standalone or Docker), not when bundled into cli.js by tsup.
// Check process.argv[1] to distinguish standalone execution from CLI bundled execution.
if (
  require.main === module &&
  /[/\\](?:mcp[/\\])?server\.(js|ts)$/.test(process.argv[1] ?? "")
) {
  const args = parseWorkspaceArg(process.argv.slice(2));
  startMcpServer(args).catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
