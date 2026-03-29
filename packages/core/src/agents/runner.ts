/**
 * Agent Runner
 *
 * Implements a tool-use agent loop: prompt the LLM, execute requested
 * tool calls via McpToolHandler, feed results back, repeat until the
 * LLM stops requesting tools or we hit max turns.
 */

import { createAgentAdapter } from "./adapters";
import type {
  AgentRunConfig,
  AgentRunResult,
  AgentTurn,
  AgentMessage,
  ToolDefinition,
  TokenUsage,
  AgentStatus,
} from "./types";
import { estimateAgentCost } from "./types";
import type { McpToolHandler } from "../mcp/handler";
import type { McpTool } from "../mcp/types";

// =============================================================================
// Event types so the server can stream progress to the UI
// =============================================================================

export type AgentRunnerEvent =
  | { type: "status"; status: AgentStatus }
  | { type: "turn:start"; turnNumber: number }
  | { type: "turn:thinking"; turnNumber: number; content: string }
  | { type: "turn:tool_call"; turnNumber: number; toolName: string; args: Record<string, unknown> }
  | { type: "turn:tool_result"; turnNumber: number; toolName: string; result: string; success: boolean }
  | { type: "turn:end"; turn: AgentTurn }
  | { type: "done"; result: AgentRunResult }
  | { type: "error"; message: string };

export type AgentRunnerEventHandler = (event: AgentRunnerEvent) => void;

// =============================================================================
// System prompt
// =============================================================================

const PLAYGROUND_SYSTEM_PROMPT = `You are a coding assistant using the Nella MCP tools to explore and work with a codebase.

Available capabilities:
- Search the indexed codebase for code, functions, classes, and documentation
- Verify generated code against the real codebase to catch hallucinations  
- Index or re-index the workspace when files change
- Get and set shared context that persists across sessions
- Check system status

When given a task:
1. Start by searching the codebase to understand the relevant code
2. Use verify to validate any code you generate
3. Use context to remember important decisions and findings
4. Be thorough but efficient — don't make unnecessary tool calls

Always explain your reasoning and findings clearly.`;

// =============================================================================
// Runner
// =============================================================================

export class AgentRunner {
  private handler: McpToolHandler;
  private tools: McpTool[];
  private abortController: AbortController | null = null;
  private status: AgentStatus = "idle";
  private eventHandler: AgentRunnerEventHandler | null = null;

  constructor(handler: McpToolHandler) {
    this.handler = handler;
    this.tools = handler.getTools();
  }

  onEvent(handler: AgentRunnerEventHandler): void {
    this.eventHandler = handler;
  }

  getStatus(): AgentStatus {
    return this.status;
  }

  /**
   * Run the agent loop.
   */
  async run(config: AgentRunConfig): Promise<AgentRunResult> {
    const maxTurns = config.maxTurns ?? 10;
    const adapter = createAgentAdapter({
      provider: config.provider,
      model: config.model,
      apiKey: config.apiKey,
    });

    this.abortController = new AbortController();
    this.setStatus("running");

    const toolDefs = this.convertToolDefs(this.tools);

    // Build initial messages
    const messages: AgentMessage[] = [
      { role: "system", content: config.systemPrompt ?? PLAYGROUND_SYSTEM_PROMPT },
      { role: "user", content: config.prompt },
    ];

    const turns: AgentTurn[] = [];
    const totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    let totalCost = 0;
    const startTime = Date.now();

    try {
      for (let turnNumber = 1; turnNumber <= maxTurns; turnNumber++) {
        if (this.abortController.signal.aborted) {
          return this.finalize(turns, totalUsage, totalCost, startTime, "stopped");
        }

        this.emit({ type: "turn:start", turnNumber });

        const turnStart = Date.now();
        const llmResult = await adapter.call({
          messages,
          tools: toolDefs,
          maxTokens: config.maxTokens,
        });

        // Accumulate token usage
        totalUsage.inputTokens += llmResult.tokenUsage.inputTokens;
        totalUsage.outputTokens += llmResult.tokenUsage.outputTokens;
        totalUsage.totalTokens += llmResult.tokenUsage.totalTokens;
        const turnCost = estimateAgentCost(config.model, llmResult.tokenUsage);
        totalCost += turnCost;

        if (llmResult.content) {
          this.emit({ type: "turn:thinking", turnNumber, content: llmResult.content });
        }

        // Add assistant message to history
        messages.push({
          role: "assistant",
          content: llmResult.content,
          toolCalls: llmResult.toolCalls.length > 0 ? llmResult.toolCalls : undefined,
        });

        // Execute tool calls
        const toolResults: AgentTurn["toolResults"] = [];

        if (llmResult.toolCalls.length > 0) {
          for (const toolCall of llmResult.toolCalls) {
            if (this.abortController.signal.aborted) break;

            this.emit({
              type: "turn:tool_call",
              turnNumber,
              toolName: toolCall.name,
              args: toolCall.arguments,
            });

            // Execute via McpToolHandler
            const mcpResult = await this.handler.handleToolCall({
              name: toolCall.name,
              arguments: toolCall.arguments,
            });

            const resultText = mcpResult.content
              .map((c) => c.text || c.code || "")
              .join("\n");

            toolResults.push({
              callId: toolCall.id,
              toolName: toolCall.name,
              result: resultText,
              success: !mcpResult.isError,
            });

            this.emit({
              type: "turn:tool_result",
              turnNumber,
              toolName: toolCall.name,
              result: resultText.slice(0, 500),
              success: !mcpResult.isError,
            });

            // Add tool result to messages
            messages.push({
              role: "tool",
              content: resultText,
              toolCallId: toolCall.id,
            });
          }
        }

        const turn: AgentTurn = {
          turnNumber,
          assistantContent: llmResult.content,
          toolCalls: llmResult.toolCalls,
          toolResults,
          tokenUsage: llmResult.tokenUsage,
          cost: turnCost,
          durationMs: Date.now() - turnStart,
        };

        turns.push(turn);
        this.emit({ type: "turn:end", turn });

        // If LLM didn't request any tool calls, we're done
        if (llmResult.stopReason === "end_turn" || llmResult.toolCalls.length === 0) {
          return this.finalize(turns, totalUsage, totalCost, startTime, "completed");
        }
      }

      // Hit max turns
      return this.finalize(turns, totalUsage, totalCost, startTime, "max_turns");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit({ type: "error", message });
      this.setStatus("error");

      return {
        turns,
        totalTokenUsage: totalUsage,
        totalCost,
        totalDurationMs: Date.now() - startTime,
        status: "error",
        error: message,
      };
    }
  }

  /**
   * Stop a running agent.
   */
  stop(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.setStatus("stopped");
    }
  }

  // ── Helpers ──

  private finalize(
    turns: AgentTurn[],
    totalUsage: TokenUsage,
    totalCost: number,
    startTime: number,
    status: AgentRunResult["status"]
  ): AgentRunResult {
    this.setStatus("idle");

    const result: AgentRunResult = {
      turns,
      totalTokenUsage: totalUsage,
      totalCost,
      totalDurationMs: Date.now() - startTime,
      status,
    };

    this.emit({ type: "done", result });
    return result;
  }

  private setStatus(status: AgentStatus): void {
    this.status = status;
    this.emit({ type: "status", status });
  }

  private emit(event: AgentRunnerEvent): void {
    try {
      this.eventHandler?.(event);
    } catch {
      // Don't let event handler errors crash the runner
    }
  }

  private convertToolDefs(mcpTools: McpTool[]): ToolDefinition[] {
    return mcpTools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as Record<string, unknown>,
    }));
  }
}
