/**
 * OpenAI (GPT) Agent Adapter — with tool-use support
 */

import { AgentAdapter, type LLMCallOptions } from "./base";
import type { LLMCallResult, ToolUseRequest, TokenUsage, ToolDefinition, AgentMessage } from "./types";

// ── OpenAI API shapes ──

interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

interface OpenAIResponse {
  id: string;
  object: "chat.completion";
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: "assistant";
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: "stop" | "tool_calls" | "length";
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class OpenAIAdapter extends AgentAdapter {
  private baseUrl = "https://api.openai.com/v1/chat/completions";

  async call(options: LLMCallOptions): Promise<LLMCallResult> {
    const openaiMessages = this.convertMessages(options.messages);

    const body: Record<string, unknown> = {
      model: this.model,
      max_completion_tokens: options.maxTokens ?? 8192,
      messages: openaiMessages,
    };

    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools.map((t) => this.convertTool(t));
    }

    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as OpenAIResponse;
    const choice = data.choices[0];
    if (!choice) {
      throw new Error("OpenAI returned no choices");
    }

    const content = choice.message.content ?? "";

    const toolCalls: ToolUseRequest[] = (choice.message.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments),
    }));

    const tokenUsage: TokenUsage = {
      inputTokens: data.usage.prompt_tokens,
      outputTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens,
    };

    const stopReason =
      choice.finish_reason === "stop"
        ? "end_turn"
        : choice.finish_reason === "tool_calls"
          ? "tool_use"
          : choice.finish_reason === "length"
            ? "max_tokens"
            : "unknown";

    return { content, toolCalls, tokenUsage, stopReason };
  }

  private convertTool(tool: ToolDefinition): OpenAITool {
    return {
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    };
  }

  private convertMessages(messages: AgentMessage[]): OpenAIMessage[] {
    return messages.map((msg) => {
      if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
        return {
          role: "assistant" as const,
          content: msg.content || null,
          tool_calls: msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        };
      }

      if (msg.role === "tool") {
        return {
          role: "tool" as const,
          content: msg.content,
          tool_call_id: msg.toolCallId,
        };
      }

      return {
        role: msg.role as "system" | "user" | "assistant",
        content: msg.content,
      };
    });
  }
}
