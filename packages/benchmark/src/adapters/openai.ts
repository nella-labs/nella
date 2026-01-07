/**
 * OpenAI (GPT) Agent Adapter
 */

import { AgentAdapter, AgentAdapterOptions, AgentAdapterResult } from "./base";
import { TokenUsage } from "../types";

interface OpenAIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenAIResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: "assistant";
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class OpenAIAdapter extends AgentAdapter {
  private baseUrl = "https://api.openai.com/v1/chat/completions";

  async call(options: AgentAdapterOptions): Promise<AgentAdapterResult> {
    const messages: OpenAIMessage[] = [
      { role: "system", content: options.systemPrompt },
      { role: "user", content: options.userPrompt },
    ];

    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: options.maxTokens ?? 8192,
        messages,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as OpenAIResponse;

    const rawResponse = data.choices[0]?.message?.content ?? "";

    const tokenUsage: TokenUsage = {
      inputTokens: data.usage.prompt_tokens,
      outputTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens,
    };

    const agentResponse = this.parseResponse(rawResponse);

    return {
      response: agentResponse,
      tokenUsage,
      rawResponse,
    };
  }
}
