/**
 * MCP Tools Types
 *
 * Types for MCP (Model Context Protocol) search tools.
 * Includes tool versioning, metadata, categories, and extended features.
 */

// =============================================================================
// Tool Category & Metadata Types
// =============================================================================

/**
 * Tool categories for grouping and filtering.
 */
export type ToolCategory =
  | "search"
  | "verification"
  | "indexing"
  | "context"
  | "analysis"
  | "code"
  | "system";

/**
 * Tool usage example.
 */
export interface ToolExample {
  description: string;
  input: Record<string, unknown>;
  expectedOutput?: string;
}

// =============================================================================
// Tool Types
// =============================================================================

/**
 * MCP Tool definition with versioning and metadata.
 */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, McpToolParameter>;
    required?: string[];
  };

  // --- Versioning ---
  /** Semantic version (e.g., "1.0.0") */
  version?: string;

  // --- Metadata ---
  /** Tool category for grouping */
  category?: ToolCategory;
  /** Tags for filtering (e.g., "read-only", "cacheable", "long-running") */
  tags?: string[];
  /** Usage examples */
  examples?: ToolExample[];

  // --- Execution hints ---
  /** Default timeout in ms */
  timeout?: number;
  /** Whether the tool is eligible for retry on transient failures */
  retryable?: boolean;
  /** Maximum retry attempts (default: 3) */
  maxRetries?: number;
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
  /** Optional: request a specific tool version */
  _meta?: {
    version?: string;
    /** MCP SDK progress token for streaming notifications */
    progressToken?: string | number;
  };
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

/**
 * Progress callback for streaming notifications.
 */
export type ProgressCallback = (progress: {
  token: string | number;
  value: number;
  total?: number;
  message?: string;
}) => void;

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
  detail?: "compact" | "full";
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
// New Tool Argument Types
// =============================================================================

/**
 * Explain tool arguments
 */
export interface ExplainToolArgs {
  query: string;
  depth?: "brief" | "detailed";
}

/**
 * Docs search tool arguments
 */
export interface DocsToolArgs {
  query: string;
  scope?: "comments" | "readme" | "all";
  limit?: number;
}

/**
 * History tool arguments
 */
export interface HistoryToolArgs {
  limit?: number;
  toolName?: string;
  since?: string; // ISO date string
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

  // --- Phase 7 extensions ---
  /** Whether the result was served from cache */
  cacheHit?: boolean;
  /** Number of retry attempts before success/failure */
  retryCount?: number;
  /** Whether the call timed out */
  timedOut?: boolean;
  /** Parent call ID for chained tool calls */
  chainedFrom?: string;
  /** Depth in the tool chain (0 = top-level) */
  chainDepth?: number;
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
 * All available nella MCP tools (core, workspace-backed)
 */
export const NELLA_TOOLS: McpTool[] = [
  // =========================================================================
  // Search
  // =========================================================================
  {
    name: "nella_search",
    description: "Search the indexed codebase for relevant code snippets, functions, classes, or documentation. Returns verified results from the actual codebase to prevent hallucinations.",
    version: "1.0.0",
    category: "search",
    tags: ["read-only", "cacheable"],
    timeout: 30_000,
    retryable: true,
    maxRetries: 2,
    examples: [
      {
        description: "Search for authentication logic",
        input: { query: "user authentication middleware", mode: "hybrid", limit: 5 },
      },
      {
        description: "Find TypeScript files containing a class",
        input: { query: "class UserService", fileTypes: [".ts"], mode: "semantic" },
      },
    ],
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

  // =========================================================================
  // Verify
  // =========================================================================
  {
    name: "nella_verify",
    description: "Verify generated code against the indexed codebase. Checks imports, symbols, and API usage to catch hallucinated references and ensure the code uses real, existing code from the project.",
    version: "1.0.0",
    category: "verification",
    tags: ["read-only", "cacheable"],
    timeout: 60_000,
    retryable: true,
    maxRetries: 2,
    examples: [
      {
        description: "Verify a code snippet using existing imports",
        input: { code: "import { UserService } from './services/user';", checkImports: true },
      },
    ],
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

  // =========================================================================
  // Index
  // =========================================================================
  {
    name: "nella_index",
    description: "Index or re-index the workspace codebase. Run this when files have changed significantly or when starting work on a new project.",
    version: "1.0.0",
    category: "indexing",
    tags: ["mutating", "long-running"],
    timeout: 300_000,
    retryable: true,
    maxRetries: 1,
    examples: [
      {
        description: "Incremental re-index of the workspace",
        input: { incremental: true },
      },
      {
        description: "Full re-index of src directory only",
        input: { paths: ["src/"], incremental: false },
      },
    ],
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

  // =========================================================================
  // Get Context
  // =========================================================================
  {
    name: "nella_get_context",
    description: "Get shared context from the workspace. Expands the agent's effective context by retrieving decisions, preferences, snippets, or other information persisted across sessions.",
    version: "1.0.0",
    category: "context",
    tags: ["read-only", "cacheable"],
    timeout: 10_000,
    retryable: false,
    examples: [
      {
        description: "Get a specific context entry",
        input: { key: "auth-strategy" },
      },
      {
        description: "Query all decisions",
        input: { types: ["decision"], limit: 10 },
      },
    ],
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

  // =========================================================================
  // Set Context
  // =========================================================================
  {
    name: "nella_set_context",
    description: "Set shared context in the workspace. Persists decisions and information beyond the current conversation, expanding effective context for future sessions.",
    version: "1.0.0",
    category: "context",
    tags: ["mutating"],
    timeout: 10_000,
    retryable: false,
    examples: [
      {
        description: "Store a design decision",
        input: {
          key: "auth-strategy",
          value: { method: "JWT", reason: "Stateless auth for microservices" },
          type: "decision",
          tags: ["auth", "architecture"],
        },
      },
    ],
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

  // =========================================================================
  // Status
  // =========================================================================
  {
    name: "nella_status",
    description: "Get the status of the nella system including index status, recent searches, usage statistics, cache metrics, and telemetry summary.",
    version: "1.0.0",
    category: "system",
    tags: ["read-only", "cacheable"],
    timeout: 5_000,
    retryable: false,
    examples: [
      {
        description: "Get full system status",
        input: {},
      },
    ],
    inputSchema: {
      type: "object",
      properties: {},
    },
  },

  // =========================================================================
  // Explain (NEW — Phase 7)
  // =========================================================================
  {
    name: "nella_explain",
    description: "Explain code snippets or symbols from the indexed codebase. Searches for the relevant code and returns a structured explanation including purpose, parameters, usage patterns, and dependencies.",
    version: "1.0.0",
    category: "analysis",
    tags: ["read-only", "cacheable"],
    timeout: 30_000,
    retryable: true,
    maxRetries: 2,
    examples: [
      {
        description: "Explain a function by name",
        input: { query: "handleAuthentication", depth: "detailed" },
      },
      {
        description: "Brief explanation of a class",
        input: { query: "UserService class", depth: "brief" },
      },
    ],
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Code snippet, symbol name, or description to explain",
        },
        depth: {
          type: "string",
          description: "Explanation depth: brief (summary) or detailed (full breakdown)",
          enum: ["brief", "detailed"],
          default: "brief",
        },
      },
      required: ["query"],
    },
  },

  // =========================================================================
  // Docs (NEW — Phase 7)
  // =========================================================================
  {
    name: "nella_docs",
    description: "Search documentation in the indexed codebase. Finds JSDoc comments, README files, markdown documentation, and inline code comments.",
    version: "1.0.0",
    category: "search",
    tags: ["read-only", "cacheable"],
    timeout: 30_000,
    retryable: true,
    maxRetries: 2,
    examples: [
      {
        description: "Search READMEs for setup instructions",
        input: { query: "getting started setup", scope: "readme" },
      },
      {
        description: "Find JSDoc for a function",
        input: { query: "authenticate user", scope: "comments", limit: 5 },
      },
    ],
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Documentation search query",
        },
        scope: {
          type: "string",
          description: "Scope: comments (JSDoc/inline), readme (*.md/README), all (everything)",
          enum: ["comments", "readme", "all"],
          default: "all",
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 10)",
          default: 10,
        },
      },
      required: ["query"],
    },
  },

  // =========================================================================
  // History (NEW — Phase 7)
  // =========================================================================
  {
    name: "nella_history",
    description: "Query the history of tool calls and context changes. Useful for reviewing what actions have been taken and debugging agent behavior.",
    version: "1.0.0",
    category: "system",
    tags: ["read-only", "cacheable"],
    timeout: 5_000,
    retryable: false,
    examples: [
      {
        description: "Get recent search history",
        input: { toolName: "nella_search", limit: 10 },
      },
      {
        description: "Get all calls from the last hour",
        input: { since: "2026-02-12T10:00:00Z", limit: 50 },
      },
    ],
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of history entries (default: 20)",
          default: 20,
        },
        toolName: {
          type: "string",
          description: "Filter by tool name",
        },
        since: {
          type: "string",
          description: "ISO 8601 date string — only show calls after this time",
        },
      },
    },
  },
];
