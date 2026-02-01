/**
 * Context Sharing Types
 *
 * Types for cross-agent context sharing.
 */

// =============================================================================
// Context Types
// =============================================================================

/**
 * Shared context entry
 */
export interface ContextEntry {
  /** Unique context ID */
  id: string;
  
  /** Context key (for lookup) */
  key: string;
  
  /** Context value */
  value: unknown;
  
  /** Value type hint */
  type: ContextType;
  
  /** Source agent ID */
  sourceAgentId: string;
  
  /** Workspace ID */
  workspaceId: string;
  
  /** Tags for filtering */
  tags: string[];
  
  /** Visibility level */
  visibility: ContextVisibility;
  
  /** TTL in seconds (0 = never expires) */
  ttl: number;
  
  /** Metadata */
  metadata: {
    createdAt: string;
    updatedAt: string;
    expiresAt: string | null;
    accessCount: number;
    lastAccessedBy: string | null;
  };
}

/**
 * Context types
 */
export type ContextType =
  | "string"
  | "number"
  | "boolean"
  | "object"
  | "array"
  | "code"
  | "snippet"
  | "decision"
  | "dependency"
  | "preference";

/**
 * Context visibility levels
 */
export type ContextVisibility =
  | "private"      // Only source agent can access
  | "workspace"    // All agents in workspace can access
  | "global";      // All agents can access (admin only)

/**
 * Code snippet context
 */
export interface CodeSnippetContext {
  code: string;
  language: string;
  filePath?: string;
  startLine?: number;
  endLine?: number;
  description?: string;
}

/**
 * Decision context
 */
export interface DecisionContext {
  decision: string;
  rationale: string;
  alternatives?: string[];
  timestamp: string;
}

/**
 * Dependency context
 */
export interface DependencyContext {
  name: string;
  version: string;
  type: "runtime" | "dev" | "peer";
  reason?: string;
}

// =============================================================================
// Channel Types
// =============================================================================

/**
 * Context channel (namespace for grouping)
 */
export interface ContextChannel {
  /** Channel ID */
  id: string;
  
  /** Channel name */
  name: string;
  
  /** Description */
  description: string;
  
  /** Workspace ID */
  workspaceId: string;
  
  /** Allowed agent IDs (empty = all) */
  allowedAgents: string[];
  
  /** Channel settings */
  settings: {
    maxEntries: number;
    defaultTtl: number;
    autoCleanup: boolean;
  };
  
  /** Metadata */
  metadata: {
    createdAt: string;
    entryCount: number;
  };
}

// =============================================================================
// Query Types
// =============================================================================

/**
 * Context query
 */
export interface ContextQuery {
  /** Search by key pattern */
  keyPattern?: string;
  
  /** Filter by tags */
  tags?: string[];
  
  /** Filter by type */
  types?: ContextType[];
  
  /** Filter by source agent */
  sourceAgentId?: string;
  
  /** Filter by visibility */
  visibility?: ContextVisibility;
  
  /** Include expired */
  includeExpired?: boolean;
  
  /** Limit results */
  limit?: number;
  
  /** Order by */
  orderBy?: "createdAt" | "updatedAt" | "accessCount";
  
  /** Order direction */
  order?: "asc" | "desc";
}

/**
 * Context query result
 */
export interface ContextQueryResult {
  entries: ContextEntry[];
  total: number;
  hasMore: boolean;
}

// =============================================================================
// Context Events
// =============================================================================

export type ContextEvent =
  | { type: "context:set"; entry: ContextEntry }
  | { type: "context:get"; entryId: string; agentId: string }
  | { type: "context:delete"; entryId: string }
  | { type: "context:expired"; entryId: string }
  | { type: "channel:created"; channel: ContextChannel }
  | { type: "channel:deleted"; channelId: string };

// =============================================================================
// Store Types
// =============================================================================

export interface ContextStore {
  entries: ContextEntry[];
  channels: ContextChannel[];
  version: string;
  updatedAt: string;
}

// =============================================================================
// Defaults
// =============================================================================

export const DEFAULT_CHANNEL_SETTINGS = {
  maxEntries: 1000,
  defaultTtl: 3600, // 1 hour
  autoCleanup: true,
};

export const DEFAULT_CONTEXT_TTL = 0; // Never expires
