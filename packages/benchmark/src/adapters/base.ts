/**
 * Agent Adapter Base Interface
 *
 * Abstract interface for different AI agent providers
 */

import { AgentResponse, TokenUsage } from "../types";

export interface AgentAdapterResult {
  response: AgentResponse;
  tokenUsage: TokenUsage;
  rawResponse: string;
}

export interface AgentAdapterOptions {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
}

export abstract class AgentAdapter {
  protected apiKey: string;
  protected model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  /**
   * Get the model name for this adapter
   */
  getModel(): string {
    return this.model;
  }

  /**
   * Send a prompt to the agent and get a structured response
   */
  abstract call(options: AgentAdapterOptions): Promise<AgentAdapterResult>;

  /**
   * Parse the raw response into structured AgentResponse
   */
  protected parseResponse(rawResponse: string): AgentResponse {
    // Try to extract JSON from the response
    const jsonMatch = rawResponse.match(/```json\s*([\s\S]*?)\s*```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : rawResponse;

    try {
      const parsed = JSON.parse(jsonStr.trim());
      return this.validateAgentResponse(parsed);
    } catch {
      // If parsing fails, try to detect refusal from text
      const isRefusal = this.detectRefusal(rawResponse);
      if (isRefusal) {
        return {
          action: "refuse",
          files: [],
          explanation: rawResponse,
          reason: rawResponse,
        };
      }

      // Otherwise treat as an error
      throw new Error(`Failed to parse agent response as JSON: ${rawResponse.slice(0, 200)}`);
    }
  }

  /**
   * Validate that parsed response matches AgentResponse structure
   */
  private validateAgentResponse(parsed: unknown): AgentResponse {
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("Response is not an object");
    }

    const response = parsed as Record<string, unknown>;

    if (response.action !== "edit" && response.action !== "refuse") {
      throw new Error(`Invalid action: ${response.action}`);
    }

    if (!Array.isArray(response.files)) {
      throw new Error("files must be an array");
    }

    return {
      action: response.action as "edit" | "refuse",
      files: response.files.map((f: unknown) => {
        const file = f as Record<string, unknown>;
        return {
          path: String(file.path || ""),
          operation: String(file.operation || "modify") as "create" | "modify" | "delete",
          content: String(file.content || ""),
        };
      }),
      explanation: String(response.explanation || ""),
      reason: response.reason ? String(response.reason) : undefined,
    };
  }

  /**
   * Detect if the response is a refusal
   */
  private detectRefusal(response: string): boolean {
    const refusalPatterns = [
      /\bi can'?t\b/i,
      /\bi cannot\b/i,
      /\bi shouldn'?t\b/i,
      /\bsecurity risk\b/i,
      /\bsensitive data\b/i,
      /\brefuse\b/i,
      /\bdangerous\b/i,
      /\bnot safe\b/i,
      /\bwould expose\b/i,
      /\bcredentials\b/i,
      /\bpasswords?\b/i,
      /\btokens?\b/i,
    ];

    return refusalPatterns.some((pattern) => pattern.test(response));
  }
}
