/**
 * Agent Types for Playground
 *
 * Types for LLM agent integration in the nella playground.
 */

// =============================================================================
// Provider / Config
// =============================================================================

export type AgentProvider = "anthropic" | "openai" | "azure-openai";

export interface AgentConfig {
  provider: AgentProvider;
  model: string;
  apiKey: string;
  maxTokens?: number;
  /** Azure OpenAI endpoint (required for azure-openai provider) */
  azureEndpoint?: string;
  /** Azure OpenAI deployment name (defaults to model if not set) */
  azureDeployment?: string;
  /** Azure API version (defaults to 2025-01-01-preview) */
  azureApiVersion?: string;
}

// =============================================================================
// Messages (multi-turn)
// =============================================================================

export interface AgentMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** For tool-result messages */
  toolCallId?: string;
  /** For assistant messages that request tool calls */
  toolCalls?: ToolUseRequest[];
}

export interface ToolUseRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

// =============================================================================
// Tool definitions sent to the LLM
// =============================================================================

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// =============================================================================
// Token / Cost tracking
// =============================================================================

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ModelPricing {
  inputCostPerMillion: number;
  outputCostPerMillion: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic
  "claude-sonnet-4-20250514": { inputCostPerMillion: 3, outputCostPerMillion: 15 },
  "claude-opus-4-20250514": { inputCostPerMillion: 15, outputCostPerMillion: 75 },
  "claude-3-5-sonnet-20241022": { inputCostPerMillion: 3, outputCostPerMillion: 15 },
  // OpenAI
  "gpt-4-turbo": { inputCostPerMillion: 10, outputCostPerMillion: 30 },
  "gpt-4o": { inputCostPerMillion: 2.5, outputCostPerMillion: 10 },
  "gpt-4o-mini": { inputCostPerMillion: 0.15, outputCostPerMillion: 0.6 },
};

export function estimateAgentCost(model: string, usage: TokenUsage): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;
  return (
    (usage.inputTokens / 1_000_000) * pricing.inputCostPerMillion +
    (usage.outputTokens / 1_000_000) * pricing.outputCostPerMillion
  );
}

// =============================================================================
// Adapter result
// =============================================================================

export interface LLMCallResult {
  /** Text content from the assistant (may be empty when only tool calls) */
  content: string;
  /** Tool calls the model wants to make */
  toolCalls: ToolUseRequest[];
  /** Token usage for this turn */
  tokenUsage: TokenUsage;
  /** Stop reason */
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "unknown";
}

// =============================================================================
// Runner types
// =============================================================================

export type AgentStatus = "idle" | "running" | "paused" | "stopped" | "error";

export interface AgentRunConfig {
  provider: AgentProvider;
  model: string;
  apiKey: string;
  prompt: string;
  /** Override the default system prompt. Falls back to the built-in prompt when omitted. */
  systemPrompt?: string;
  maxTurns?: number;
  maxTokens?: number;
}

export interface AgentTurn {
  turnNumber: number;
  assistantContent: string;
  toolCalls: ToolUseRequest[];
  toolResults: Array<{ callId: string; toolName: string; result: string; success: boolean }>;
  tokenUsage: TokenUsage;
  cost: number;
  durationMs: number;
}

export interface AgentRunResult {
  turns: AgentTurn[];
  totalTokenUsage: TokenUsage;
  totalCost: number;
  totalDurationMs: number;
  status: "completed" | "max_turns" | "stopped" | "error";
  error?: string;
}
