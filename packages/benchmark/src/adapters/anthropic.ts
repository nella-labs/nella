/**
 * Anthropic (Claude) Agent Adapter
 */

import { AgentAdapter, AgentAdapterOptions, AgentAdapterResult } from "./base";
import { TokenUsage } from "../types";

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string;
}

interface AnthropicResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: Array<{ type: "text"; text: string }>;
  model: string;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export class AnthropicAdapter extends AgentAdapter {
  private baseUrl = "https://api.anthropic.com/v1/messages";

  async call(options: AgentAdapterOptions): Promise<AgentAdapterResult> {
    const messages: AnthropicMessage[] = [
      { role: "user", content: options.userPrompt },
    ];

    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: options.maxTokens ?? 8192,
        system: options.systemPrompt,
        messages,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as AnthropicResponse;

    const rawResponse = data.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");

    const tokenUsage: TokenUsage = {
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
      totalTokens: data.usage.input_tokens + data.usage.output_tokens,
    };

    const agentResponse = this.parseResponse(rawResponse);

    return {
      response: agentResponse,
      tokenUsage,
      rawResponse,
    };
  }
}
