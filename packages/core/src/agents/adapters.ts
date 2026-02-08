/**
 * Agent Adapter Factory
 */

import type { AgentConfig } from "./types";
import { AgentAdapter } from "./base";
import { AnthropicAdapter } from "./anthropic";
import { OpenAIAdapter } from "./openai";

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
