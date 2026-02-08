/**
 * Agent Adapter Base
 *
 * Abstract class for LLM provider adapters that support multi-turn
 * conversations with tool use.
 */

import type { AgentMessage, LLMCallResult, ToolDefinition } from "./types";

export interface LLMCallOptions {
  messages: AgentMessage[];
  tools?: ToolDefinition[];
  maxTokens?: number;
}

export abstract class AgentAdapter {
  protected apiKey: string;
  protected model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  getModel(): string {
    return this.model;
  }

  /**
   * Send messages to the LLM and get back content + tool calls.
   */
  abstract call(options: LLMCallOptions): Promise<LLMCallResult>;
}
