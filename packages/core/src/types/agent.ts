/**
 * Agent Types
 *
 * Types for agent responses and file changes.
 */

// =============================================================================
// File Changes
// =============================================================================

/**
 * A file change proposed by an agent
 */
export interface FileChange {
  /** Relative path from repo root */
  path: string;

  /** Type of change */
  operation: "create" | "modify" | "delete";

  /** New file content (empty for delete) */
  content: string;
}

// =============================================================================
// Agent Response
// =============================================================================

/**
 * Structured response from an agent
 */
export interface AgentResponse {
  /** Whether agent edited or refused */
  action: "edit" | "refuse";

  /** Files to change (empty for refuse) */
  files: FileChange[];

  /** Agent's explanation/reasoning */
  explanation: string;

  /** Reason for refusal (if action is refuse) */
  reason?: string;
}

// =============================================================================
// Changes Input
// =============================================================================

/**
 * Changes to apply for validation (from agent or test harness)
 */
export interface Changes {
  /** Files that were modified */
  files: FileChange[];

  /** Git diff of changes (if available) */
  diff?: string;
}
