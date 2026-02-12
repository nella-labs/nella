/**
 * Playground Server Types
 *
 * Types for the real-time playground server.
 */

// =============================================================================
// Session Types
// =============================================================================

/**
 * Playground session
 */
export interface PlaygroundSession {
  /** Session ID */
  id: string;
  
  /** Workspace ID */
  workspaceId: string;
  
  /** Connected client IDs */
  clients: string[];
  
  /** Session state */
  state: SessionState;
  
  /** Created at */
  createdAt: string;
  
  /** Last activity */
  lastActivity: string;
  
  /** Session metadata */
  metadata: {
    totalToolCalls: number;
    totalTokens: number;
    estimatedCost: number;
  };
}

/**
 * Session state
 */
export interface SessionState {
  /** Active agent */
  activeAgent: string | null;
  
  /** Current chain of thought */
  chainOfThought: ChainOfThoughtEntry[];
  
  /** Recent tool calls */
  recentToolCalls: ToolCallEntry[];
  
  /** Recent searches */
  recentSearches: SearchEntry[];
  
  /** Current index status */
  indexStatus: "none" | "indexing" | "ready" | "error";
  
  /** Rate limit status */
  rateLimitStatus: {
    minute: { used: number; limit: number };
    hour: { used: number; limit: number };
  };
}

/**
 * Chain of thought entry
 */
export interface ChainOfThoughtEntry {
  id: string;
  type: "thought" | "action" | "observation" | "result";
  content: string;
  timestamp: string;
  duration?: number;
}

/**
 * Tool call entry
 */
export interface ToolCallEntry {
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  success: boolean;
  error?: string;
  duration: number;
  timestamp: string;
  tokens?: number;
  cost?: number;
}

/**
 * Search entry
 */
export interface SearchEntry {
  id: string;
  query: string;
  resultsCount: number;
  confidence: number;
  duration: number;
  timestamp: string;
}

// =============================================================================
// WebSocket Message Types
// =============================================================================

/**
 * Client to server messages
 */
export type ClientMessage =
  | { type: "subscribe"; sessionId: string }
  | { type: "unsubscribe"; sessionId: string }
  | { type: "tool:call"; toolName: string; arguments: Record<string, unknown>; callId?: string }
  | { type: "session:clear" }
  | { type: "index:start"; incremental?: boolean }
  | { type: "context:get"; key?: string }
  | { type: "context:set"; key: string; value: unknown };

/**
 * Server to client messages
 */
export type ServerMessage =
  | { type: "session:state"; state: SessionState }
  | { type: "session:update"; update: Partial<SessionState> }
  | { type: "cot:entry"; entry: ChainOfThoughtEntry }
  | { type: "tool:start"; callId: string; toolName: string }
  | { type: "tool:end"; callId: string; entry: ToolCallEntry }
  | { type: "search:result"; entry: SearchEntry }
  | { type: "index:progress"; percent: number; status: string }
  | { type: "index:complete"; stats: { files: number; chunks: number; tokens: number } }
  | { type: "rate:warning"; window: string; percentUsed: number }
  | { type: "error"; message: string; code?: string }
  | { type: "connected"; sessionId: string; clientId: string }
  | { type: "workspace:info"; workspace: { name: string; path: string; indexStatus: string; filesIndexed: number; chunksCount: number } }
  | { type: "context:data"; key: string; value: unknown; version?: number }
  | { type: "context:updated"; key: string; success: boolean; error?: string };

// =============================================================================
// Server Config
// =============================================================================

export interface PlaygroundServerConfig {
  /** HTTP port */
  port: number;
  
  /** Host to bind to */
  host: string;
  
  /** Workspace path */
  workspacePath: string;
  
  /** Enable CORS */
  cors: boolean;
  
  /** Allowed origins (if CORS enabled) */
  allowedOrigins: string[];
  
  /** Session timeout (ms) */
  sessionTimeout: number;
  
  /** Max sessions per workspace */
  maxSessions: number;
  
  /** Enable authentication */
  authEnabled: boolean;
  
  /** Storage path for nella data */
  storagePath: string;

  /** Enable TLS (HTTPS) */
  tls?: boolean;

  /** Path to TLS certificate file */
  tlsCert?: string;

  /** Path to TLS private key file */
  tlsKey?: string;

  /** Max concurrent WebSocket connections (0 = unlimited) */
  maxConnections?: number;
}

// =============================================================================
// Cost Calculation
// =============================================================================

export interface CostConfig {
  /** Cost per 1K input tokens */
  inputCostPer1k: number;
  
  /** Cost per 1K output tokens */
  outputCostPer1k: number;
  
  /** Embedding cost per 1K tokens */
  embeddingCostPer1k: number;
}

export const DEFAULT_COST_CONFIG: CostConfig = {
  inputCostPer1k: 0.003, // GPT-4 pricing example
  outputCostPer1k: 0.006,
  embeddingCostPer1k: 0.0001, // Voyage pricing
};

// =============================================================================
// Defaults
// =============================================================================

export const DEFAULT_SERVER_CONFIG: Omit<PlaygroundServerConfig, "workspacePath" | "storagePath"> = {
  port: 3847,
  host: "localhost",
  cors: true,
  allowedOrigins: ["*"],
  sessionTimeout: 30 * 60 * 1000, // 30 minutes
  maxSessions: 10,
  authEnabled: false,
};
