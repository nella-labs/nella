/**
 * Agent Adapter Factory
 */

import type { AgentConfig } from "./types";
import { AgentAdapter } from "./base";
import { AnthropicAdapter } from "./anthropic";
import { OpenAIAdapter } from "./openai";
import { AzureOpenAIAdapter } from "./azure-openai";

export function createAgentAdapter(config: AgentConfig): AgentAdapter {
  switch (config.provider) {
    case "anthropic":
      return new AnthropicAdapter(config.apiKey, config.model);
    case "openai":
      return new OpenAIAdapter(config.apiKey, config.model);
    case "azure-openai": {
      if (!config.azureEndpoint) {
        throw new Error("azureEndpoint is required for azure-openai provider");
      }
      return new AzureOpenAIAdapter(
        config.apiKey,
        config.model,
        config.azureEndpoint,
        config.azureDeployment,
        config.azureApiVersion,
      );
    }
    default:
      throw new Error(`Unknown agent provider: ${config.provider}`);
  }
}
