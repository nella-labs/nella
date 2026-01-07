/**
 * Agent Adapters Index
 *
 * Factory for creating agent adapters based on provider
 */

export { AgentAdapter, AgentAdapterOptions, AgentAdapterResult } from "./base";
export { AnthropicAdapter } from "./anthropic";
export { OpenAIAdapter } from "./openai";

import { AgentAdapter } from "./base";
import { AnthropicAdapter } from "./anthropic";
import { OpenAIAdapter } from "./openai";
import { AgentConfig } from "../types";

/**
 * Create an agent adapter based on provider configuration
 */
export function createAgentAdapter(config: AgentConfig): AgentAdapter {
  switch (config.provider) {
    case "anthropic":
      return new AnthropicAdapter(config.apiKey, config.model);
    case "openai":
      return new OpenAIAdapter(config.apiKey, config.model);
    default:
      throw new Error(`Unknown agent provider: ${config.provider}`);
  }
}
