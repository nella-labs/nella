/**
 * MCP Tools Types
 *
 * Types for MCP (Model Context Protocol) search tools.
 */

// =============================================================================
// Tool Types
// =============================================================================

/**
 * MCP Tool definition
 */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, McpToolParameter>;
    required?: string[];
  };
}

/**
 * MCP Tool parameter
 */
export interface McpToolParameter {
  type: "string" | "number" | "boolean" | "array" | "object";
  description: string;
  enum?: string[];
  items?: { type: string };
  default?: unknown;
}

/**
 * MCP Tool call
 */
export interface McpToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * MCP Tool result
 */
export interface McpToolResult {
  content: Array<{
    type: "text" | "code" | "image";
    text?: string;
    code?: string;
    language?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

// =============================================================================
// Search Tool Types
// =============================================================================

/**
 * Search tool arguments
 */
export interface SearchToolArgs {
  query: string;
  limit?: number;
  mode?: "semantic" | "lexical" | "hybrid";
  fileTypes?: string[];
  paths?: string[];
  includeSymbols?: boolean;
}

/**
 * Verify tool arguments
 */
export interface VerifyToolArgs {
  code: string;
  language?: string;
  checkImports?: boolean;
  checkSymbols?: boolean;
  checkApi?: boolean;
}

/**
 * Index tool arguments
 */
export interface IndexToolArgs {
  paths?: string[];
  incremental?: boolean;
  include?: string[];
  exclude?: string[];
}

/**
 * Get context tool arguments
 */
export interface GetContextToolArgs {
  key?: string;
  tags?: string[];
  types?: string[];
  limit?: number;
}

/**
 * Set context tool arguments
 */
export interface SetContextToolArgs {
  key: string;
  value: unknown;
  type?: string;
  tags?: string[];
  ttl?: number;
}

// =============================================================================
// Tool Metadata
// =============================================================================

/**
 * Tool call metadata (for tracking)
 */
export interface ToolCallMetadata {
  callId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  startTime: number;
  endTime?: number;
  duration?: number;
  success: boolean;
  error?: string;
  tokensUsed?: number;
  costEstimate?: number;
}

// =============================================================================
// MCP Events
// =============================================================================

export type McpEvent =
  | { type: "tool:call:start"; metadata: ToolCallMetadata }
  | { type: "tool:call:end"; metadata: ToolCallMetadata }
  | { type: "tool:call:error"; metadata: ToolCallMetadata; error: string };

// =============================================================================
// Tool Registry
// =============================================================================

/**
 * All available nella MCP tools
 */
export const NELLA_TOOLS: McpTool[] = [
  {
    name: "nella_search",
    description: "Search the indexed codebase for relevant code snippets, functions, classes, or documentation. Returns verified results from the actual codebase to prevent hallucinations.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query - can be natural language or code-related terms",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return (default: 10)",
          default: 10,
        },
        mode: {
          type: "string",
          description: "Search mode: semantic (meaning), lexical (exact match), or hybrid (both)",
          enum: ["semantic", "lexical", "hybrid"],
          default: "hybrid",
        },
        fileTypes: {
          type: "array",
          description: "Filter by file extensions (e.g., ['.ts', '.js'])",
          items: { type: "string" },
        },
        paths: {
          type: "array",
          description: "Filter to specific paths or directories",
          items: { type: "string" },
        },
      },
      required: ["query"],
    },
  },
  {
    name: "nella_verify",
    description: "Verify generated code against the indexed codebase. Checks imports, symbols, and API usage to ensure the code is valid and uses real, existing code from the project.",
    inputSchema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "The code to verify",
        },
        language: {
          type: "string",
          description: "Programming language (default: typescript)",
          default: "typescript",
        },
        checkImports: {
          type: "boolean",
          description: "Verify that imports exist in the codebase",
          default: true,
        },
        checkSymbols: {
          type: "boolean",
          description: "Verify that referenced symbols (functions, classes, etc.) exist",
          default: true,
        },
        checkApi: {
          type: "boolean",
          description: "Verify API calls match the indexed signatures",
          default: true,
        },
      },
      required: ["code"],
    },
  },
  {
    name: "nella_index",
    description: "Index or re-index the workspace codebase. Run this when files have changed significantly or when starting work on a new project.",
    inputSchema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          description: "Specific paths to index (default: entire workspace)",
          items: { type: "string" },
        },
        incremental: {
          type: "boolean",
          description: "Only index changed files (default: true)",
          default: true,
        },
        include: {
          type: "array",
          description: "Glob patterns to include",
          items: { type: "string" },
        },
        exclude: {
          type: "array",
          description: "Glob patterns to exclude",
          items: { type: "string" },
        },
      },
    },
  },
  {
    name: "nella_get_context",
    description: "Get shared context from the workspace. Useful for retrieving decisions, preferences, snippets, or other information shared between agents.",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Specific context key to retrieve",
        },
        tags: {
          type: "array",
          description: "Filter by tags",
          items: { type: "string" },
        },
        types: {
          type: "array",
          description: "Filter by context types (decision, snippet, dependency, preference)",
          items: { type: "string" },
        },
        limit: {
          type: "number",
          description: "Maximum number of results",
          default: 20,
        },
      },
    },
  },
  {
    name: "nella_set_context",
    description: "Set shared context in the workspace. Use this to share decisions, important information, or preferences with other agents.",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Context key (identifier)",
        },
        value: {
          type: "object",
          description: "The value to store",
        },
        type: {
          type: "string",
          description: "Context type",
          enum: ["string", "object", "decision", "snippet", "dependency", "preference"],
        },
        tags: {
          type: "array",
          description: "Tags for filtering",
          items: { type: "string" },
        },
        ttl: {
          type: "number",
          description: "Time-to-live in seconds (0 = never expires)",
          default: 0,
        },
      },
      required: ["key", "value"],
    },
  },
  {
    name: "nella_status",
    description: "Get the status of the nella system including index status, recent searches, and usage statistics.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];
