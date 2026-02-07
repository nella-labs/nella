/**
 * MCP Tool Handler
 *
 * Handles MCP tool calls and routes them to appropriate services.
 */

import * as crypto from "crypto";
import type {
  McpTool,
  McpToolCall,
  McpToolResult,
  McpEvent,
  ToolCallMetadata,
  SearchToolArgs,
  VerifyToolArgs,
  IndexToolArgs,
  GetContextToolArgs,
  SetContextToolArgs,
} from "./types";
import { NELLA_TOOLS } from "./types";
import type { Workspace } from "../workspace";
import type { Authenticator, AuthResult } from "../auth";
import type { RateLimiter, RateLimitResult } from "../rate-limit";
import type { ContextManager } from "../context-sharing";

// =============================================================================
// Types
// =============================================================================

export interface ToolHandlerConfig {
  workspace: Workspace;
  authenticator?: Authenticator;
  rateLimiter?: RateLimiter;
  contextManager?: ContextManager;
  agentId?: string;
  apiKey?: string;
}

export type McpEventHandler = (event: McpEvent) => void;

// =============================================================================
// Tool Handler Class
// =============================================================================

export class McpToolHandler {
  private workspace: Workspace;
  private authenticator?: Authenticator;
  private rateLimiter?: RateLimiter;
  private contextManager?: ContextManager;
  private agentId?: string;
  private apiKey?: string;
  private eventHandlers: McpEventHandler[] = [];
  private callHistory: ToolCallMetadata[] = [];

  constructor(config: ToolHandlerConfig) {
    this.workspace = config.workspace;
    this.authenticator = config.authenticator;
    this.rateLimiter = config.rateLimiter;
    this.contextManager = config.contextManager;
    this.agentId = config.agentId;
    this.apiKey = config.apiKey;
  }

  // =============================================================================
  // Event Handling
  // =============================================================================

  onEvent(handler: McpEventHandler): void {
    this.eventHandlers.push(handler);
  }

  private emit(event: McpEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error("MCP event handler error:", error);
      }
    }
  }

  // =============================================================================
  // Tool Handling
  // =============================================================================

  /**
   * Get all available tools
   */
  getTools(): McpTool[] {
    return NELLA_TOOLS;
  }

  /**
   * Handle a tool call
   */
  async handleToolCall(call: McpToolCall): Promise<McpToolResult> {
    const callId = `call_${crypto.randomBytes(8).toString("hex")}`;
    const metadata: ToolCallMetadata = {
      callId,
      toolName: call.name,
      arguments: call.arguments,
      startTime: Date.now(),
      success: false,
    };

    this.emit({ type: "tool:call:start", metadata });

    try {
      // Check authentication if configured
      if (this.authenticator && this.apiKey) {
        const authResult = await this.authenticator.authenticate({
          apiKey: this.apiKey,
          action: this.getActionForTool(call.name),
        });

        if (!authResult.success) {
          throw new Error(`Authentication failed: ${authResult.error}`);
        }
      }

      // Check rate limit if configured
      if (this.rateLimiter && this.agentId) {
        const limitResult = this.rateLimiter.consume({
          entityId: this.agentId,
          entityType: "agent",
        });

        if (!limitResult.allowed) {
          throw new Error(`Rate limit exceeded: ${limitResult.reason}. Retry after ${limitResult.retryAfter}s`);
        }
      }

      // Route to handler
      let result: McpToolResult;
      switch (call.name) {
        case "nella_search":
          result = await this.handleSearch(call.arguments as unknown as SearchToolArgs);
          break;
        case "nella_verify":
          result = await this.handleVerify(call.arguments as unknown as VerifyToolArgs);
          break;
        case "nella_index":
          result = await this.handleIndex(call.arguments as unknown as IndexToolArgs);
          break;
        case "nella_get_context":
          result = await this.handleGetContext(call.arguments as unknown as GetContextToolArgs);
          break;
        case "nella_set_context":
          result = await this.handleSetContext(call.arguments as unknown as SetContextToolArgs);
          break;
        case "nella_status":
          result = await this.handleStatus();
          break;
        default:
          throw new Error(`Unknown tool: ${call.name}`);
      }

      metadata.success = true;
      metadata.endTime = Date.now();
      metadata.duration = metadata.endTime - metadata.startTime;

      this.callHistory.push(metadata);
      this.emit({ type: "tool:call:end", metadata });

      // Release rate limit slot
      if (this.rateLimiter && this.agentId) {
        this.rateLimiter.release(this.agentId);
      }

      return result;
    } catch (error) {
      metadata.success = false;
      metadata.error = error instanceof Error ? error.message : String(error);
      metadata.endTime = Date.now();
      metadata.duration = metadata.endTime - metadata.startTime;

      this.callHistory.push(metadata);
      this.emit({ type: "tool:call:error", metadata, error: metadata.error });

      // Release rate limit slot on error too
      if (this.rateLimiter && this.agentId) {
        this.rateLimiter.release(this.agentId);
      }

      return {
        content: [{ type: "text", text: `Error: ${metadata.error}` }],
        isError: true,
      };
    }
  }

  // =============================================================================
  // Tool Handlers
  // =============================================================================

  private async handleSearch(args: SearchToolArgs): Promise<McpToolResult> {
    const response = await this.workspace.search({
      query: args.query,
      limit: args.limit || 10,
      mode: args.mode || "hybrid",
      filter: {
        fileTypes: args.fileTypes,
        paths: args.paths,
      },
    });

    if (response.results.length === 0) {
      const suggestion = response.suggestion !== "use_results"
        ? ` Suggestion: ${response.suggestion.replace("_", " ")}.`
        : "";
      return {
        content: [{
          type: "text",
          text: `No results found for "${args.query}".${suggestion}`,
        }],
      };
    }

    const results = response.results.map((r, i) => {
      const chunk = r.chunk;
      const startLine = chunk.lines?.[0];
      const header = `## Result ${i + 1}: ${chunk.filePath}${startLine ? `:${startLine}` : ""}\n`;
      const metadata = `Type: ${chunk.type} | Score: ${(r.score * 100).toFixed(1)}%\n`;
      const symbols = chunk.symbols?.length ? `Symbols: ${chunk.symbols.map((s) => s.name).join(", ")}\n` : "";
      return `${header}${metadata}${symbols}\n\`\`\`${chunk.language || ""}\n${chunk.content}\n\`\`\``;
    });

    return {
      content: [
        {
          type: "text",
          text: `Found ${response.results.length} results (confidence: ${(response.confidence * 100).toFixed(0)}%):\n\n${results.join("\n\n")}`,
        },
      ],
    };
  }

  private async handleVerify(args: VerifyToolArgs): Promise<McpToolResult> {
    const result = await this.workspace.verify({
      code: args.code,
      checkImports: args.checkImports ?? true,
      checkSymbols: args.checkSymbols ?? true,
      checkAPIs: args.checkApi ?? true,
    });

    let text: string;

    if (result.valid) {
      text = "✅ Code verification passed!\n\n";
    } else {
      text = "❌ Code verification failed!\n\n";
      text += "Issues found:\n";
      for (const issue of result.issues) {
        const severity = issue.severity === "error" ? "🔴" : issue.severity === "warning" ? "🟡" : "🔵";
        text += `${severity} ${issue.type}: ${issue.message}`;
        if (issue.suggestion) {
          text += ` (Suggestion: ${issue.suggestion})`;
        }
        text += "\n";
      }
    }

    if (result.suggestions.length > 0) {
      text += `\nSuggestions: ${result.suggestions.join(", ")}\n`;
    }

    text += `\nConfidence: ${(result.confidence * 100).toFixed(0)}%`;

    return {
      content: [{ type: "text", text }],
    };
  }

  private async handleIndex(args: IndexToolArgs): Promise<McpToolResult> {
    await this.workspace.index({
      incremental: args.incremental ?? true,
    });

    const stats = this.workspace.stats;

    return {
      content: [{
        type: "text",
        text: `✅ Indexing complete!\n\nFiles indexed: ${stats.filesIndexed}\nChunks created: ${stats.chunksCount}\nTokens processed: ${stats.totalTokens}`,
      }],
    };
  }

  private async handleGetContext(args: GetContextToolArgs): Promise<McpToolResult> {
    if (!this.contextManager) {
      return {
        content: [{ type: "text", text: "Context manager not configured" }],
        isError: true,
      };
    }

    if (args.key) {
      const entry = this.contextManager.get(args.key, this.workspace.id, this.agentId);
      if (!entry) {
        return {
          content: [{ type: "text", text: `Context not found: ${args.key}` }],
        };
      }

      return {
        content: [{
          type: "text",
          text: `Context: ${entry.key}\nType: ${entry.type}\nValue: ${JSON.stringify(entry.value, null, 2)}`,
        }],
      };
    }

    const result = this.contextManager.query(this.workspace.id, {
      tags: args.tags,
      types: args.types as any,
      limit: args.limit || 20,
    }, this.agentId);

    if (result.entries.length === 0) {
      return {
        content: [{ type: "text", text: "No context entries found" }],
      };
    }

    const entries = result.entries.map((e) => 
      `- ${e.key} (${e.type}): ${JSON.stringify(e.value).slice(0, 100)}...`
    );

    return {
      content: [{
        type: "text",
        text: `Found ${result.entries.length} context entries:\n\n${entries.join("\n")}`,
      }],
    };
  }

  private async handleSetContext(args: SetContextToolArgs): Promise<McpToolResult> {
    if (!this.contextManager) {
      return {
        content: [{ type: "text", text: "Context manager not configured" }],
        isError: true,
      };
    }

    const entry = this.contextManager.set({
      key: args.key,
      value: args.value,
      type: args.type as any,
      sourceAgentId: this.agentId || "unknown",
      workspaceId: this.workspace.id,
      tags: args.tags,
      ttl: args.ttl,
    });

    return {
      content: [{
        type: "text",
        text: `✅ Context set: ${entry.key}\nID: ${entry.id}\nType: ${entry.type}`,
      }],
    };
  }

  private async handleStatus(): Promise<McpToolResult> {
    const info = this.workspace.getInfo();
    const recentCalls = this.callHistory.slice(-10);

    let text = `# Nella Status\n\n`;
    text += `## Workspace\n`;
    text += `- Name: ${info.name}\n`;
    text += `- Path: ${info.path}\n`;
    text += `- Index Status: ${info.indexStatus}\n`;
    text += `- Files Indexed: ${info.stats.filesIndexed}\n`;
    text += `- Chunks: ${info.stats.chunksCount}\n`;
    text += `- Tokens: ${info.stats.totalTokens}\n\n`;

    if (recentCalls.length > 0) {
      text += `## Recent Tool Calls\n`;
      for (const call of recentCalls.slice(-5)) {
        const status = call.success ? "✅" : "❌";
        text += `${status} ${call.toolName} (${call.duration}ms)\n`;
      }
    }

    return {
      content: [{ type: "text", text }],
    };
  }

  // =============================================================================
  // Helpers
  // =============================================================================

  private getActionForTool(toolName: string): "search" | "verify" | "index" | "read_context" | "write_context" | "admin" {
    switch (toolName) {
      case "nella_search":
        return "search";
      case "nella_verify":
        return "verify";
      case "nella_index":
        return "index";
      case "nella_get_context":
        return "read_context";
      case "nella_set_context":
        return "write_context";
      case "nella_status":
        return "search";
      default:
        return "search";
    }
  }

  /**
   * Get call history
   */
  getCallHistory(): ToolCallMetadata[] {
    return [...this.callHistory];
  }

  /**
   * Clear call history
   */
  clearCallHistory(): void {
    this.callHistory = [];
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createMcpToolHandler(config: ToolHandlerConfig): McpToolHandler {
  return new McpToolHandler(config);
}
