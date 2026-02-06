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

  /** ETag for optimistic concurrency (SHA-256 of serialised value) */
  etag: string;

  /** Whether the stored value is encrypted */
  encrypted: boolean;

  /** Channel this entry belongs to (null = no channel) */
  channelId: string | null;

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
  | "private"    // Only source agent can access
  | "workspace"  // All agents in workspace can access
  | "shared"     // Accessible across workspaces
  | "global";    // All agents can access (admin only)

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
// Versioning Types
// =============================================================================

/**
 * A snapshot of a context value at a point in time
 */
export interface ContextVersion {
  /** Value at this version */
  value: unknown;

  /** When the version was recorded */
  updatedAt: string;

  /** Who caused the update */
  updatedBy: string;
}

// =============================================================================
// Schema Types
// =============================================================================

/**
 * Schema validation result
 */
export interface SchemaValidationResult {
  valid: boolean;
  issues: string[];
}

/**
 * Context schema — hand-written validator matching the codebase's
 * existing WorkspaceValidator pattern (no zod).
 */
export interface ContextSchema {
  /** Key pattern to match (supports * wildcards) */
  keyPattern: string;

  /** Validate a value against this schema */
  validate: (value: unknown) => SchemaValidationResult;
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

  /** Filter by channel */
  channelId?: string;

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

/**
 * Search options for full-text value search
 */
export interface ContextSearchOptions {
  /** Workspace to search in */
  workspaceId: string;

  /** Use regex instead of substring match */
  regex?: boolean;

  /** Use fuzzy matching (Jaro-Winkler via natural) */
  fuzzy?: boolean;

  /** Fuzzy threshold (0-1, default 0.8) */
  fuzzyThreshold?: number;

  /** Filter by type */
  types?: ContextType[];

  /** Filter by tags */
  tags?: string[];

  /** Max results */
  limit?: number;
}

// =============================================================================
// Import/Export Types
// =============================================================================

/**
 * Serialisable snapshot for import/export
 */
export interface ContextSnapshot {
  /** Snapshot format version */
  version: string;

  /** When the snapshot was created */
  exportedAt: string;

  /** Source workspace (if filtered) */
  workspaceId?: string;

  /** All entries */
  entries: ContextEntry[];

  /** Version history for entries */
  versions: Record<string, ContextVersion[]>; // entry ID → versions

  /** Channel definitions */
  channels: ContextChannel[];

  /** Registered schema key patterns */
  schemaPatterns: string[];
}

/**
 * Strategy for importing context
 */
export type ImportStrategy = "merge" | "replace" | "skip-existing";

// =============================================================================
// Context Events
// =============================================================================

export type ContextEvent =
  | { type: "context:set"; entry: ContextEntry }
  | { type: "context:get"; entryId: string; agentId: string }
  | { type: "context:delete"; entryId: string }
  | { type: "context:expired"; entryId: string }
  | { type: "context:expiring"; entryId: string; expiresAt: string }
  | { type: "context:conflict"; key: string; storedEtag: string; expectedEtag: string }
  | { type: "context:validation_failed"; key: string; issues: string[] }
  | { type: "context:channel_message"; channel: string; entryId: string }
  | { type: "context:imported"; count: number; strategy: ImportStrategy }
  | { type: "context:exported"; count: number }
  | { type: "channel:created"; channel: ContextChannel }
  | { type: "channel:deleted"; channelId: string };

// =============================================================================
// Store Types (Legacy — kept for migration detection)
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

export const DEFAULT_MAX_VERSIONS = 50;

export const DEFAULT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export const DEFAULT_EXPIRING_WARNING_MS = 60 * 1000; // 60 seconds before expiry
