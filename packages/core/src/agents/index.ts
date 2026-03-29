/**
 * Agents Module
 *
 * LLM agent integration for the nella playground.
 * Provides adapters for Anthropic and OpenAI, plus an agent runner
 * that implements a tool-use loop over the MCP tools.
 */

// Types
export type {
  AgentProvider,
  AgentConfig,
  AgentMessage,
  ToolUseRequest,
  ToolDefinition,
  TokenUsage,
  ModelPricing,
  LLMCallResult,
  AgentStatus,
  AgentRunConfig,
  AgentTurn,
  AgentRunResult,
} from "./types";

export { MODEL_PRICING, estimateAgentCost } from "./types";

// Adapters
export { AgentAdapter } from "./base";
export type { LLMCallOptions } from "./base";
export { AnthropicAdapter } from "./anthropic";
export { OpenAIAdapter } from "./openai";
export { AzureOpenAIAdapter } from "./azure-openai";
export { createAgentAdapter } from "./adapters";

// Runner
export { AgentRunner } from "./runner";
export type { AgentRunnerEvent, AgentRunnerEventHandler } from "./runner";
