/**
 * Anthropic (Claude) Agent Adapter — with tool-use support
 */

import { AgentAdapter, type LLMCallOptions } from "./base";
import type { LLMCallResult, ToolUseRequest, TokenUsage, ToolDefinition, AgentMessage } from "./types";

// ── Anthropic API shapes ──

interface AnthropicToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

interface AnthropicMsg {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

interface AnthropicResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: "end_turn" | "tool_use" | "max_tokens";
  usage: { input_tokens: number; output_tokens: number };
}

export class AnthropicAdapter extends AgentAdapter {
  private baseUrl = "https://api.anthropic.com/v1/messages";

  async call(options: LLMCallOptions): Promise<LLMCallResult> {
    // Separate system message
    const systemMsg = options.messages.find((m) => m.role === "system");
    const conversationMessages = options.messages.filter((m) => m.role !== "system");

    const anthropicMessages = this.convertMessages(conversationMessages);

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: options.maxTokens ?? 8192,
      messages: anthropicMessages,
    };

    if (systemMsg) {
      body.system = systemMsg.content;
    }

    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools.map((t) => this.convertTool(t));
    }

    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as AnthropicResponse;

    // Extract text content
    const textBlocks = data.content.filter((b): b is { type: "text"; text: string } => b.type === "text");
    const content = textBlocks.map((b) => b.text).join("\n");

    // Extract tool calls
    const toolBlocks = data.content.filter(
      (b): b is { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } =>
        b.type === "tool_use"
    );
    const toolCalls: ToolUseRequest[] = toolBlocks.map((b) => ({
      id: b.id,
      name: b.name,
      arguments: b.input,
    }));

    const tokenUsage: TokenUsage = {
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
      totalTokens: data.usage.input_tokens + data.usage.output_tokens,
    };

    const stopReason =
      data.stop_reason === "end_turn"
        ? "end_turn"
        : data.stop_reason === "tool_use"
          ? "tool_use"
          : data.stop_reason === "max_tokens"
            ? "max_tokens"
            : "unknown";

    return { content, toolCalls, tokenUsage, stopReason };
  }

  private convertTool(tool: ToolDefinition): AnthropicToolDef {
    return {
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    };
  }

  private convertMessages(messages: AgentMessage[]): AnthropicMsg[] {
    const result: AnthropicMsg[] = [];

    for (const msg of messages) {
      if (msg.role === "user") {
        result.push({ role: "user", content: msg.content });
      } else if (msg.role === "assistant") {
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          // Reconstruct the assistant message with tool_use blocks
          const blocks: AnthropicContentBlock[] = [];
          if (msg.content) {
            blocks.push({ type: "text", text: msg.content });
          }
          for (const tc of msg.toolCalls) {
            blocks.push({
              type: "tool_use",
              id: tc.id,
              name: tc.name,
              input: tc.arguments,
            });
          }
          result.push({ role: "assistant", content: blocks });
        } else {
          result.push({ role: "assistant", content: msg.content });
        }
      } else if (msg.role === "tool") {
        // Tool results go as user messages with tool_result content
        result.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: msg.toolCallId!,
              content: msg.content,
            },
          ],
        });
      }
    }

    return result;
  }
}
