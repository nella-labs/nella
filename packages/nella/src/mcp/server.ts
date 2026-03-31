#!/usr/bin/env node
/**
 * Nella MCP Server
 *
 * Model Context Protocol server that exposes Nella's codebase intelligence
 * to AI agents like Claude.
 *
 * Usage:
 *   npx -y @getnella/mcp --workspace /path/to/project  # direct stdio entrypoint
 *   nella mcp --workspace /path/to/project            # via CLI subcommand
 */

import * as crypto from "crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import * as https from "https";
import { ContextManager, deriveHmacKey } from "@usenella/core";
import { parseWorkspaceArg } from "./utils/args";
import { getValidSession } from "../auth";
import { registerContextTools, handleContextTool } from "./tools/context";
import { registerIndexingTools, handleIndexingTool } from "./tools/indexing";
import { registerAgentTools, handleAgentTool } from "./tools/agents";
import { registerHeartbeatTool, handleHeartbeat, createChallengeState } from "./tools/heartbeat";
import type { ChallengeState } from "./tools/heartbeat";

// =============================================================================
// Usage Logging (fire-and-forget to nella API)
// =============================================================================

// Cached session — validated once on startup, reused for all tool calls
let cachedSession: { access_token: string } | null = null;

async function initSession(): Promise<{ access_token: string } | null> {
  const session = await getValidSession();
  if (session) {
    cachedSession = session;
    return session;
  }
  return null;
}

async function logUsage(toolName: string, durationMs: number, success: boolean, result?: CallToolResult, args?: Record<string, unknown>): Promise<void> {
  const session = cachedSession;
  if (!session) {
    console.error(`[nella] Cannot log usage for ${toolName}: not authenticated`);
    return;
  }

  const inputText = JSON.stringify(args || {});
  const outputText = result?.content?.map((c: any) => c.text || "").join("") || "";
  const tokensUsed = Math.ceil(inputText.length / 4) + Math.ceil(outputText.length / 4);
  const body = JSON.stringify({
    tool_name: toolName,
    duration_ms: durationMs,
    success,
    tokens_used: Math.max(tokensUsed, 1),
  });

  // Retry up to 2 times — usage MUST be tracked
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const url = new URL("https://app.getnella.dev/api/usage/log");
        const req = https.request(
          {
            hostname: url.hostname,
            port: 443,
            path: url.pathname,
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
              "Content-Length": Buffer.byteLength(body),
            },
          },
          (res) => {
            // Drain response
            res.resume();
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`HTTP ${res.statusCode}`));
            } else {
              resolve();
            }
          }
        );
        req.on("error", reject);
        req.setTimeout(10000, () => {
          req.destroy();
          reject(new Error("timeout"));
        });
        req.write(body);
        req.end();
      });
      return; // success
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < 2) {
        console.error(`[nella] Usage log attempt ${attempt + 1} failed for ${toolName}: ${msg}, retrying...`);
      } else {
        console.error(`[nella] Usage log FAILED after 3 attempts for ${toolName}: ${msg}`);
      }
    }
  }
}

// =============================================================================
// Types
// =============================================================================

export interface ServerContext {
  workspacePath: string;
  contextManager: ContextManager;
  /** Per-session trust token for prompt injection defense (L4) */
  sessionToken?: string;
  /** HMAC signing key derived from session token (L4+) */
  hmacKey?: Buffer;
  /** Challenge-response state for trust chain verification (L4+) */
  challengeState?: ChallengeState;
}

// =============================================================================
// Main
// =============================================================================

export async function startMcpServer(args: { workspace?: string; help?: boolean }): Promise<void> {
  if (args.help) {
    console.error(`
Nella MCP Server - Codebase intelligence for AI coding agents

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

  // Require authentication — no free rides
  const session = await initSession();
  if (!session) {
    console.error("[nella] Not authenticated. Run 'nella login' to continue.");
    console.error("[nella] Authentication is required to use Nella.");
    process.exit(1);
  }

  // Initialize context manager for stateful tracking
  const contextManager = new ContextManager(workspacePath);

  // Generate per-session trust token for prompt injection defense (L4)
  const sessionToken = `nella-verify-${crypto.randomBytes(16).toString("hex")}`;
  const hmacKey = deriveHmacKey(sessionToken);
  const challengeState = createChallengeState();

  const serverContext: ServerContext = {
    workspacePath,
    contextManager,
    sessionToken,
    hmacKey,
    challengeState,
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
    ...registerContextTools(),
    ...registerIndexingTools(),
    ...registerAgentTools(),
    registerHeartbeatTool(),
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
      const start = Date.now();
      try {
        // Try each tool category
        const contextResult = await handleContextTool(name, toolArgs || {}, serverContext);
        if (contextResult !== null) {
          await logUsage(name, Date.now() - start, !contextResult.isError, contextResult as CallToolResult, toolArgs);
          return contextResult as CallToolResult;
        }

        const indexingResult = await handleIndexingTool(name, toolArgs || {}, serverContext);
        if (indexingResult !== null) {
          await logUsage(name, Date.now() - start, !indexingResult.isError, indexingResult as CallToolResult, toolArgs);
          return indexingResult as CallToolResult;
        }

        const agentResult = await handleAgentTool(name, toolArgs || {}, serverContext);
        if (agentResult !== null) {
          await logUsage(name, Date.now() - start, !agentResult.isError, agentResult as CallToolResult, toolArgs);
          return agentResult as CallToolResult;
        }

        // Heartbeat tool (challenge-response)
        if (name === "nella_heartbeat" && serverContext.challengeState) {
          const { result: hbResult, newState } = handleHeartbeat(toolArgs || {}, serverContext.challengeState);
          serverContext.challengeState = newState;
          await logUsage(name, Date.now() - start, true, hbResult as CallToolResult, toolArgs);
          return hbResult as CallToolResult;
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
        await logUsage(name, Date.now() - start, false);
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
