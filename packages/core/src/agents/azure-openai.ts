/**
 * Azure OpenAI Agent Adapter — with tool-use support
 *
 * Uses Azure's OpenAI endpoint format:
 *   {endpoint}/openai/deployments/{deployment}/chat/completions?api-version={version}
 *
 * Auth via `api-key` header instead of Bearer token.
 */

import { AgentAdapter, type LLMCallOptions } from "./base";
import type { LLMCallResult, ToolUseRequest, TokenUsage, ToolDefinition, AgentMessage } from "./types";

// Reuse OpenAI API shapes — Azure OpenAI returns the same format
interface AzureOpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

interface AzureOpenAIResponse {
  id: string;
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

const DEFAULT_API_VERSION = "2025-01-01-preview";

export class AzureOpenAIAdapter extends AgentAdapter {
  private endpoint: string;
  private deployment: string;
  private apiVersion: string;

  constructor(
    apiKey: string,
    model: string,
    endpoint: string,
    deployment?: string,
    apiVersion?: string,
  ) {
    super(apiKey, model);
    this.endpoint = endpoint.replace(/\/$/, "");
    this.deployment = deployment || model;
    this.apiVersion = apiVersion || DEFAULT_API_VERSION;
  }

  private get url(): string {
    return `${this.endpoint}/openai/deployments/${this.deployment}/chat/completions?api-version=${this.apiVersion}`;
  }

  async call(options: LLMCallOptions): Promise<LLMCallResult> {
    const messages = this.convertMessages(options.messages);

    const body: Record<string, unknown> = {
      max_tokens: options.maxTokens ?? 8192,
      messages,
    };

    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools.map((t) => this.convertTool(t));
    }

    const response = await fetch(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": this.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Azure OpenAI API error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as AzureOpenAIResponse;
    const choice = data.choices[0];
    if (!choice) throw new Error("Azure OpenAI returned no choices");

    const content = choice.message.content || "";
    const toolCalls: ToolUseRequest[] = (choice.message.tool_calls || []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments || "{}"),
    }));

    const tokenUsage: TokenUsage = {
      inputTokens: data.usage.prompt_tokens,
      outputTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens,
    };

    let stopReason: LLMCallResult["stopReason"] = "unknown";
    if (choice.finish_reason === "stop") stopReason = "end_turn";
    else if (choice.finish_reason === "tool_calls") stopReason = "tool_use";
    else if (choice.finish_reason === "length") stopReason = "max_tokens";

    return { content, toolCalls, tokenUsage, stopReason };
  }

  private convertMessages(messages: AgentMessage[]): AzureOpenAIMessage[] {
    return messages.map((m) => {
      const msg: AzureOpenAIMessage = { role: m.role, content: m.content };
      if (m.toolCalls) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        }));
      }
      if (m.toolCallId) {
        msg.tool_call_id = m.toolCallId;
      }
      return msg;
    });
  }

  private convertTool(tool: ToolDefinition) {
    return {
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    };
  }
}
