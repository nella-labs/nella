/**
 * Context Types
 *
 * Types for stateful context tracking across agent runs.
 * Enables agents to remember changes and enforce consistency over time.
 */

// =============================================================================
// Session Types
// =============================================================================

/**
 * A session that persists across multiple runs
 */
export interface Session {
  /** Unique session identifier */
  id: string;

  /** When the session started */
  startedAt: string;

  /** Repository path this session tracks */
  repoPath: string;

  /** All recorded changes in this session */
  changes: ChangeRecord[];

  /** Active assumptions about the codebase */
  assumptions: Assumption[];

  /** Last known state of dependencies */
  dependencySnapshot: DependencySnapshot | null;

  /** Session metadata */
  metadata: SessionMetadata;
}

/**
 * Session metadata
 */
export interface SessionMetadata {
  /** Last activity timestamp */
  lastActivityAt: string;

  /** Total number of runs in this session */
  runCount: number;

  /** Total files modified across all runs */
  totalFilesModified: number;
}

// =============================================================================
// Change Tracking Types
// =============================================================================

/**
 * Record of a single file change
 */
export interface ChangeRecord {
  /** Unique identifier for this change */
  id: string;

  /** When the change was made */
  timestamp: string;

  /** Run ID that made this change */
  runId: string;

  /** File path that was changed */
  file: string;

  /** Type of operation */
  operation: "create" | "modify" | "delete";

  /** Why the agent made this change */
  reason: string;

  /** Files this change depends on (assumes exist/work) */
  dependsOn: string[];

  /** Assumption IDs this change relies on */
  assumptionIds: string[];

  /** Hash of file content after change (for modification detection) */
  contentHash?: string;
}

/**
 * Summary of changes for a specific file
 */
export interface FileChangeHistory {
  /** File path */
  file: string;

  /** All changes to this file */
  changes: ChangeRecord[];

  /** Current state */
  currentState: "exists" | "deleted" | "unknown";

  /** Last modified timestamp */
  lastModifiedAt: string | null;
}

// =============================================================================
// Assumption Types
// =============================================================================

/**
 * Something the agent believes to be true about the codebase
 */
export interface Assumption {
  /** Unique identifier */
  id: string;

  /** When the assumption was created */
  createdAt: string;

  /** Human-readable description of the assumption */
  description: string;

  /** Type of assumption */
  type: AssumptionType;

  /** Files this assumption is about */
  relatedFiles: string[];

  /** Is this assumption still valid? */
  valid: boolean;

  /** When the assumption was invalidated */
  invalidatedAt?: string;

  /** Run ID that invalidated this assumption */
  invalidatedBy?: string;

  /** Why it was invalidated */
  invalidationReason?: string;

  /** Confidence level (0-1) */
  confidence: number;
}

/**
 * Types of assumptions
 */
export type AssumptionType =
  | "schema" // Database/API schema assumptions
  | "interface" // TypeScript interface/type assumptions
  | "dependency" // Package dependency assumptions
  | "behavior" // Function/method behavior assumptions
  | "config" // Configuration assumptions
  | "structure" // File/folder structure assumptions
  | "other";

/**
 * Result of checking assumptions against changes
 */
export interface AssumptionCheckResult {
  /** Total assumptions checked */
  totalChecked: number;

  /** Assumptions that are still valid */
  valid: Assumption[];

  /** Assumptions that were just invalidated */
  newlyInvalidated: Assumption[];

  /** Assumptions that were already invalid */
  previouslyInvalidated: Assumption[];

  /** Potential conflicts with planned changes */
  conflicts: AssumptionConflict[];
}

/**
 * A conflict between a planned change and an existing assumption
 */
export interface AssumptionConflict {
  /** The assumption that might be affected */
  assumption: Assumption;

  /** The planned file change */
  plannedFile: string;

  /** Severity of the conflict */
  severity: "warning" | "error";

  /** Suggested action */
  suggestion: string;
}

// =============================================================================
// Dependency Types
// =============================================================================

/**
 * Snapshot of dependency state at a point in time
 */
export interface DependencySnapshot {
  /** When the snapshot was taken */
  takenAt: string;

  /** Hash of package.json */
  packageJsonHash: string;

  /** Hash of lockfile (package-lock.json, pnpm-lock.yaml, yarn.lock) */
  lockfileHash: string;

  /** Type of lockfile detected */
  lockfileType: "npm" | "pnpm" | "yarn" | "none";

  /** Installed packages with versions */
  packages: Record<string, PackageInfo>;

  /** Node.js version if detectable */
  nodeVersion?: string;
}

/**
 * Information about a single package
 */
export interface PackageInfo {
  /** Package version */
  version: string;

  /** Is it a dev dependency? */
  isDev: boolean;
}

/**
 * A change in dependencies between snapshots
 */
export interface DependencyChange {
  /** Type of change */
  type: "added" | "removed" | "updated";

  /** Package name */
  package: string;

  /** New version (for added/updated) */
  version?: string;

  /** Previous version (for updated/removed) */
  previousVersion?: string;

  /** Is it a dev dependency? */
  isDev: boolean;
}

/**
 * Result of comparing dependency snapshots
 */
export interface DependencyDiff {
  /** Were there any changes? */
  hasChanges: boolean;

  /** Individual changes */
  changes: DependencyChange[];

  /** Did package.json change? */
  packageJsonChanged: boolean;

  /** Did lockfile change? */
  lockfileChanged: boolean;

  /** Assumptions that might be affected by these changes */
  affectedAssumptions: Assumption[];
}

// =============================================================================
// Context API Types
// =============================================================================

/**
 * Full context available to the agent
 */
export interface AgentContext {
  /** Current session */
  session: Session;

  /** Recent changes (last N) */
  recentChanges: ChangeRecord[];

  /** Valid assumptions */
  validAssumptions: Assumption[];

  /** Current dependency state */
  dependencies: DependencySnapshot | null;

  /** Any recent invalidations */
  recentInvalidations: Assumption[];

  /** Summary statistics */
  stats: ContextStats;
}

/**
 * Context statistics
 */
export interface ContextStats {
  /** Total changes in session */
  totalChanges: number;

  /** Files with most changes */
  hotspotFiles: Array<{ file: string; changeCount: number }>;

  /** Total valid assumptions */
  validAssumptionCount: number;

  /** Total invalidated assumptions */
  invalidatedAssumptionCount: number;

  /** Session duration in minutes */
  sessionDurationMinutes: number;
}
