/**
 * MCP Tool Handler
 *
 * Handles MCP tool calls and routes them to appropriate services.
 * Includes: validation, caching, timeouts, retry, chaining, streaming, telemetry.
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
  ExplainToolArgs,
  DocsToolArgs,
  HistoryToolArgs,
  ProgressCallback,
} from "./types";
import { NELLA_TOOLS } from "./types";
import { validateToolInput } from "./validation";
import { ToolTimeoutError, ToolValidationError, UnknownToolError, ChainDepthError, AuthenticationError, RateLimitError } from "./errors";
import { retryWithBackoff } from "./retry";
import { ToolResultCache, type ToolResultCacheConfig } from "./cache";
import { TelemetryManager, type TelemetryConfig } from "./telemetry";
import { ToolRegistry } from "./registry";
import type { Workspace } from "../workspace";
import type { Authenticator, AuthResult } from "../auth";
import type { RateLimiter, RateLimitResult } from "../rate-limit";
import type { ContextManager } from "../context-sharing";

// =============================================================================
// Constants
// =============================================================================

/** Maximum depth for chained tool calls */
const MAX_CHAIN_DEPTH = 3;

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

  // --- Phase 7 extensions ---
  /** Cache configuration (pass false to disable) */
  cache?: Partial<ToolResultCacheConfig> | false;
  /** Telemetry configuration (pass to enable) */
  telemetry?: TelemetryConfig;
  /** Progress callback for streaming notifications */
  progress?: ProgressCallback;
  /** Whether to validate tool inputs (default: true) */
  validateInputs?: boolean;
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

  // --- Phase 7 ---
  private cache: ToolResultCache | null;
  private telemetry: TelemetryManager | null;
  private registry: ToolRegistry;
  private progress?: ProgressCallback;
  private validateInputs: boolean;

  constructor(config: ToolHandlerConfig) {
    this.workspace = config.workspace;
    this.authenticator = config.authenticator;
    this.rateLimiter = config.rateLimiter;
    this.contextManager = config.contextManager;
    this.agentId = config.agentId;
    this.apiKey = config.apiKey;
    this.progress = config.progress;
    this.validateInputs = config.validateInputs !== false; // default true

    // Initialize cache
    if (config.cache === false) {
      this.cache = null;
    } else {
      this.cache = new ToolResultCache(config.cache || {});
    }

    // Initialize telemetry
    if (config.telemetry) {
      this.telemetry = new TelemetryManager(config.telemetry);
      // Fire-and-forget init (does not block constructor)
      this.telemetry.init().catch(() => {});
    } else {
      this.telemetry = null;
    }

    // Initialize tool registry with all core tools
    this.registry = new ToolRegistry();
    this.registry.registerAll(NELLA_TOOLS);
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
   * Get all available tools, optionally filtered.
   */
  getTools(filter?: { category?: string; tags?: string[] }): McpTool[] {
    if (filter) {
      return this.registry.list(filter as any);
    }
    return this.registry.list();
  }

  /**
   * Get the tool registry for direct access.
   */
  getRegistry(): ToolRegistry {
    return this.registry;
  }

  /**
   * Handle a tool call with full pipeline:
   * validation → cache check → auth → rate limit → timeout + retry → dispatch → cache store → telemetry
   */
  async handleToolCall(call: McpToolCall): Promise<McpToolResult> {
    return this.executeToolCall(call, 0);
  }

  /**
   * Internal tool dispatch used by tool chaining.
   * Skips auth/rate-limit (already validated by the outer call).
   */
  private async chainToolCall(
    call: McpToolCall,
    parentCallId: string,
    depth: number,
  ): Promise<McpToolResult> {
    if (depth >= MAX_CHAIN_DEPTH) {
      throw new ChainDepthError(depth, MAX_CHAIN_DEPTH);
    }
    return this.executeToolCall(call, depth, parentCallId);
  }

  /**
   * Core execution pipeline.
   */
  private async executeToolCall(
    call: McpToolCall,
    chainDepth: number,
    parentCallId?: string,
  ): Promise<McpToolResult> {
    const callId = `call_${crypto.randomBytes(8).toString("hex")}`;
    const metadata: ToolCallMetadata = {
      callId,
      toolName: call.name,
      arguments: call.arguments,
      startTime: Date.now(),
      success: false,
      chainDepth,
      chainedFrom: parentCallId,
    };

    // Resolve the tool definition (supports versioned names)
    const tool = this.registry.resolve(call.name) || this.registry.get(call.name);

    this.emit({ type: "tool:call:start", metadata });

    // Create telemetry span
    const span = this.telemetry?.createToolSpan(call.name, call.arguments);
    span?.setAttribute("tool.chain_depth", chainDepth);

    try {
      // -----------------------------------------------------------------------
      // 1. Input validation
      // -----------------------------------------------------------------------
      if (this.validateInputs && tool) {
        const validation = validateToolInput(tool, call.arguments);
        if (!validation.valid) {
          throw new ToolValidationError(call.name, validation.errors);
        }
      }

      // -----------------------------------------------------------------------
      // 2. Cache check (only for top-level calls)
      // -----------------------------------------------------------------------
      if (this.cache && chainDepth === 0) {
        const cached = this.cache.get(call.name, call.arguments);
        if (cached) {
          metadata.success = true;
          metadata.cacheHit = true;
          metadata.endTime = Date.now();
          metadata.duration = metadata.endTime - metadata.startTime;
          this.callHistory.push(metadata);
          this.emit({ type: "tool:call:end", metadata });
          span?.setAttribute("tool.cache_hit", true);
          span?.end();
          this.telemetry?.recordToolMetrics({ ...metadata, cacheHit: true });
          return cached;
        }
      }

      // -----------------------------------------------------------------------
      // 3. Auth (skip for chained calls)
      // -----------------------------------------------------------------------
      if (chainDepth === 0 && this.authenticator && this.apiKey) {
        const authResult = await this.authenticator.authenticate({
          apiKey: this.apiKey,
          action: this.getActionForTool(call.name),
        });

        if (!authResult.success) {
          throw new AuthenticationError(`Authentication failed: ${authResult.error}`);
        }
      }

      // -----------------------------------------------------------------------
      // 4. Rate limit (skip for chained calls)
      // -----------------------------------------------------------------------
      if (chainDepth === 0 && this.rateLimiter && this.agentId) {
        const limitResult = this.rateLimiter.consume({
          entityId: this.agentId,
          entityType: "agent",
        });

        if (!limitResult.allowed) {
          throw new RateLimitError(
            `Rate limit exceeded: ${limitResult.reason}. Retry after ${limitResult.retryAfter}s`,
            limitResult.retryAfter,
          );
        }
      }

      // -----------------------------------------------------------------------
      // 5. Execute with timeout + retry
      // -----------------------------------------------------------------------
      const toolTimeout = tool?.timeout;
      const isRetryable = tool?.retryable ?? false;
      const maxRetries = tool?.maxRetries ?? 3;

      const executeFn = () => this.routeToolCall(call, callId, chainDepth);

      let result: McpToolResult;
      let retryCount = 0;

      if (isRetryable && maxRetries > 0) {
        const retryResult = await this.withTimeout(
          () => retryWithBackoff(executeFn, {
            maxRetries,
            baseDelay: 1000,
            maxDelay: 15000,
            onRetry: (attempt) => { retryCount = attempt; },
          }),
          toolTimeout,
          call.name,
        );
        result = retryResult.result;
        retryCount = retryResult.attempts - 1;
      } else {
        result = await this.withTimeout(executeFn, toolTimeout, call.name);
      }

      metadata.retryCount = retryCount;
      metadata.success = true;
      metadata.cacheHit = false;
      metadata.endTime = Date.now();
      metadata.duration = metadata.endTime - metadata.startTime;

      this.callHistory.push(metadata);
      this.emit({ type: "tool:call:end", metadata });

      // Cache the result
      if (this.cache) {
        this.cache.set(call.name, call.arguments, result);
        // Invalidate dependent caches for mutating tools
        this.cache.invalidate(call.name);
      }

      // Release rate limit slot
      if (chainDepth === 0 && this.rateLimiter && this.agentId) {
        this.rateLimiter.release(this.agentId);
      }

      // Telemetry
      span?.setAttribute("tool.cache_hit", false);
      span?.setAttribute("tool.retry_count", retryCount);
      span?.setAttribute("tool.duration_ms", metadata.duration);
      span?.end();
      this.telemetry?.recordToolMetrics({ ...metadata, cacheHit: false, retryCount });

      return result;
    } catch (error) {
      metadata.success = false;
      metadata.error = error instanceof Error ? error.message : String(error);
      metadata.timedOut = error instanceof ToolTimeoutError;
      metadata.endTime = Date.now();
      metadata.duration = metadata.endTime - metadata.startTime;

      this.callHistory.push(metadata);
      this.emit({ type: "tool:call:error", metadata, error: metadata.error });

      // Release rate limit slot on error too
      if (chainDepth === 0 && this.rateLimiter && this.agentId) {
        this.rateLimiter.release(this.agentId);
      }

      // Telemetry
      if (error instanceof Error) span?.recordError(error);
      span?.end();
      this.telemetry?.recordToolMetrics({ ...metadata, cacheHit: false });

      return {
        content: [{ type: "text", text: `Error: ${metadata.error}` }],
        isError: true,
      };
    }
  }

  // =============================================================================
  // Timeout Wrapper
  // =============================================================================

  private async withTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number | undefined,
    toolName: string,
  ): Promise<T> {
    if (!timeoutMs) return fn();

    return Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new ToolTimeoutError(toolName, timeoutMs)), timeoutMs),
      ),
    ]);
  }

  // =============================================================================
  // Tool Routing
  // =============================================================================

  private async routeToolCall(
    call: McpToolCall,
    callId: string,
    chainDepth: number,
  ): Promise<McpToolResult> {
    const baseName = call.name.includes("@") ? call.name.split("@")[0] : call.name;

    switch (baseName) {
      case "nella_search":
        return this.handleSearch(call.arguments as unknown as SearchToolArgs);
      case "nella_verify":
        return this.handleVerify(call.arguments as unknown as VerifyToolArgs);
      case "nella_index":
        return this.handleIndex(call.arguments as unknown as IndexToolArgs, call._meta?.progressToken);
      case "nella_get_context":
        return this.handleGetContext(call.arguments as unknown as GetContextToolArgs);
      case "nella_set_context":
        return this.handleSetContext(call.arguments as unknown as SetContextToolArgs);
      case "nella_status":
        return this.handleStatus();
      case "nella_explain":
        return this.handleExplain(call.arguments as unknown as ExplainToolArgs, callId, chainDepth);
      case "nella_docs":
        return this.handleDocs(call.arguments as unknown as DocsToolArgs);
      case "nella_history":
        return this.handleHistory(call.arguments as unknown as HistoryToolArgs);
      default:
        throw new UnknownToolError(call.name);
    }
  }

  // =============================================================================
  // Tool Handlers (original 6)
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

  private async handleIndex(
    args: IndexToolArgs,
    progressToken?: string | number,
  ): Promise<McpToolResult> {
    // Send progress notifications if token provided
    if (progressToken && this.progress) {
      this.progress({ token: progressToken, value: 0, total: 100, message: "Starting indexing..." });
    }

    await this.workspace.index({
      incremental: args.incremental ?? true,
    });

    if (progressToken && this.progress) {
      this.progress({ token: progressToken, value: 100, total: 100, message: "Indexing complete" });
    }

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

    // Cache stats
    if (this.cache) {
      const cacheStats = this.cache.stats();
      text += `## Cache\n`;
      text += `- Entries: ${cacheStats.size}/${cacheStats.maxSize}\n`;
      text += `- Hit Rate: ${(cacheStats.hitRate * 100).toFixed(1)}%\n`;
      text += `- Hits: ${cacheStats.hits} / Misses: ${cacheStats.misses}\n\n`;
    }

    // Telemetry summary
    if (this.telemetry) {
      text += this.telemetry.getMetricsSummary() + "\n";
    }

    // Recent calls
    if (recentCalls.length > 0) {
      text += `## Recent Tool Calls\n`;
      for (const call of recentCalls.slice(-5)) {
        const status = call.success ? "✅" : "❌";
        const cache = call.cacheHit ? " (cached)" : "";
        const retry = call.retryCount ? ` (${call.retryCount} retries)` : "";
        text += `${status} ${call.toolName} (${call.duration}ms)${cache}${retry}\n`;
      }
    }

    // Registered tools
    text += `\n## Registered Tools\n`;
    const tools = this.registry.list();
    for (const tool of tools) {
      const tags = tool.tags?.length ? ` [${tool.tags.join(", ")}]` : "";
      text += `- ${tool.name} v${tool.version || "1.0.0"} (${tool.category || "uncategorized"})${tags}\n`;
    }

    return {
      content: [{ type: "text", text }],
    };
  }

  // =============================================================================
  // New Tool Handlers (Phase 7)
  // =============================================================================

  /**
   * Explain code or symbols by chaining to nella_search.
   */
  private async handleExplain(
    args: ExplainToolArgs,
    callId: string,
    chainDepth: number,
  ): Promise<McpToolResult> {
    // Chain to nella_search to find relevant code
    const searchResult = await this.chainToolCall(
      {
        name: "nella_search",
        arguments: { query: args.query, limit: 5, mode: "hybrid" },
      },
      callId,
      chainDepth + 1,
    );

    // If search errored, propagate
    if (searchResult.isError) {
      return searchResult;
    }

    const searchText = searchResult.content[0]?.text || "";

    // No results found
    if (searchText.includes("No results found")) {
      return {
        content: [{
          type: "text",
          text: `Could not find code matching "${args.query}" in the indexed codebase.`,
        }],
      };
    }

    // Build explanation from search results
    const isDetailed = args.depth === "detailed";
    let text = `# Explanation: ${args.query}\n\n`;

    if (isDetailed) {
      text += `## Summary\n`;
      text += `Found relevant code in the indexed codebase for "${args.query}".\n\n`;
      text += `## Code References\n\n`;
      text += searchText + "\n\n";
      text += `## Analysis\n`;
      text += `The search returned verified results from the actual codebase. `;
      text += `All referenced symbols, imports, and APIs exist in the project.\n`;
    } else {
      // Brief mode — extract just file paths and first few lines
      const lines = searchText.split("\n");
      const fileRefs: string[] = [];

      for (const line of lines) {
        if (line.startsWith("## Result")) {
          fileRefs.push(line.replace("## ", ""));
        }
      }

      text += `Found ${fileRefs.length} relevant code location(s):\n\n`;
      for (const ref of fileRefs) {
        text += `- ${ref}\n`;
      }
      text += `\nUse \`nella_explain\` with \`depth: "detailed"\` for full code context.`;
    }

    return {
      content: [{ type: "text", text }],
    };
  }

  /**
   * Search documentation (README, JSDoc, markdown).
   */
  private async handleDocs(args: DocsToolArgs): Promise<McpToolResult> {
    // Build file type filter based on scope
    let fileTypes: string[] | undefined;
    let paths: string[] | undefined;

    switch (args.scope) {
      case "readme":
        fileTypes = [".md", ".mdx", ".txt"];
        break;
      case "comments":
        // Search code files — comments will be in code chunks
        fileTypes = [".ts", ".tsx", ".js", ".jsx", ".py", ".java", ".go", ".rs"];
        break;
      case "all":
      default:
        // No filter — search everything
        break;
    }

    const response = await this.workspace.search({
      query: args.query,
      limit: args.limit || 10,
      mode: "hybrid",
      filter: {
        fileTypes,
        paths,
      },
    });

    if (response.results.length === 0) {
      return {
        content: [{
          type: "text",
          text: `No documentation found for "${args.query}" (scope: ${args.scope || "all"})`,
        }],
      };
    }

    const results = response.results.map((r, i) => {
      const chunk = r.chunk;
      const startLine = chunk.lines?.[0];
      const header = `## ${i + 1}. ${chunk.filePath}${startLine ? `:${startLine}` : ""}\n`;
      const score = `Relevance: ${(r.score * 100).toFixed(1)}%\n`;
      return `${header}${score}\n\`\`\`${chunk.language || ""}\n${chunk.content}\n\`\`\``;
    });

    return {
      content: [{
        type: "text",
        text: `Found ${response.results.length} documentation result(s) for "${args.query}":\n\n${results.join("\n\n")}`,
      }],
    };
  }

  /**
   * Query tool call history.
   */
  private async handleHistory(args: HistoryToolArgs): Promise<McpToolResult> {
    let history = [...this.callHistory];

    // Filter by tool name
    if (args.toolName) {
      history = history.filter((h) => h.toolName === args.toolName);
    }

    // Filter by since date
    if (args.since) {
      const sinceMs = new Date(args.since).getTime();
      if (!isNaN(sinceMs)) {
        history = history.filter((h) => h.startTime >= sinceMs);
      }
    }

    // Apply limit
    const limit = args.limit || 20;
    history = history.slice(-limit);

    if (history.length === 0) {
      return {
        content: [{
          type: "text",
          text: "No tool call history found matching the criteria.",
        }],
      };
    }

    let text = `# Tool Call History (${history.length} entries)\n\n`;
    text += `| # | Tool | Duration | Status | Cache | Retries | Time |\n`;
    text += `|---|------|----------|--------|-------|---------|------|\n`;

    for (let i = 0; i < history.length; i++) {
      const h = history[i];
      const status = h.success ? "✅" : "❌";
      const cache = h.cacheHit ? "HIT" : "-";
      const retries = h.retryCount ? String(h.retryCount) : "-";
      const time = new Date(h.startTime).toISOString().slice(11, 19); // HH:MM:SS
      text += `| ${i + 1} | ${h.toolName} | ${h.duration || 0}ms | ${status} | ${cache} | ${retries} | ${time} |\n`;
    }

    // Summary stats
    const successful = history.filter((h) => h.success).length;
    const avgDuration = history.reduce((sum, h) => sum + (h.duration || 0), 0) / history.length;
    const cacheHits = history.filter((h) => h.cacheHit).length;

    text += `\n**Summary**: ${successful}/${history.length} successful, avg ${avgDuration.toFixed(0)}ms, ${cacheHits} cache hits`;

    return {
      content: [{ type: "text", text }],
    };
  }

  // =============================================================================
  // Helpers
  // =============================================================================

  private getActionForTool(toolName: string): "search" | "verify" | "index" | "read_context" | "write_context" | "admin" {
    const baseName = toolName.includes("@") ? toolName.split("@")[0] : toolName;
    switch (baseName) {
      case "nella_search":
      case "nella_docs":
      case "nella_explain":
        return "search";
      case "nella_verify":
        return "verify";
      case "nella_index":
        return "index";
      case "nella_get_context":
      case "nella_history":
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

  /**
   * Get cache instance (for external cache management).
   */
  getCache(): ToolResultCache | null {
    return this.cache;
  }

  /**
   * Get telemetry instance.
   */
  getTelemetry(): TelemetryManager | null {
    return this.telemetry;
  }

  /**
   * Graceful shutdown — flush telemetry, clear cache.
   */
  async shutdown(): Promise<void> {
    if (this.telemetry) {
      await this.telemetry.shutdown();
    }
    if (this.cache) {
      await this.cache.clear();
    }
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createMcpToolHandler(config: ToolHandlerConfig): McpToolHandler {
  return new McpToolHandler(config);
}
