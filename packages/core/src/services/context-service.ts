/**
 * Context Service
 *
 * Wraps ContextManager with atomic operations.
 * Eliminates the "record → invalidate → save" dance that MCP tools repeat.
 */

import { ContextManager } from "../context";
import type {
  AgentContext,
  Assumption,
  AssumptionType,
  ChangeRecord,
  FileChangeHistory,
  DependencyDiff,
} from "../types";

// =============================================================================
// Types
// =============================================================================

export interface AddAssumptionParams {
  type: AssumptionType;
  description: string;
  relatedFiles?: string[];
  confidence?: number;
}

export interface RecordChangesParams {
  files: string[];
  operation: "create" | "modify" | "delete";
  reason: string;
}

export interface RecordChangesResult {
  recorded: number;
  invalidated: Assumption[];
}

// =============================================================================
// Service
// =============================================================================

export class ContextService {
  constructor(private contextManager: ContextManager) {}

  /**
   * Get full session context.
   */
  getContext(recentChangesLimit = 20): AgentContext {
    return this.contextManager.getContext(recentChangesLimit);
  }

  /**
   * Add an assumption with auto-save.
   */
  async addAssumption(params: AddAssumptionParams): Promise<Assumption> {
    const assumption = this.contextManager.assumptions.addAssumption(
      params.description,
      params.relatedFiles || [],
      params.type,
      params.confidence
    );
    this.contextManager.save();
    return assumption;
  }

  /**
   * Get assumption status.
   */
  getAssumptionStatus(): {
    valid: Assumption[];
    invalidated: Assumption[];
    summary: {
      total: number;
      valid: number;
      invalidated: number;
      byType: Record<AssumptionType, number>;
    };
  } {
    return {
      valid: this.contextManager.assumptions.getValidAssumptions(),
      invalidated: this.contextManager.assumptions.getRecentlyInvalidated(),
      summary: this.contextManager.assumptions.getSummary(),
    };
  }

  /**
   * Get file change history.
   */
  getFileHistory(filePath: string): FileChangeHistory {
    return this.contextManager.changes.getFileHistory(filePath);
  }

  /**
   * Check for dependency changes.
   */
  checkDependencies(workspacePath: string): DependencyDiff | null {
    return this.contextManager.checkDependencies(workspacePath);
  }

  /**
   * Record changes with automatic assumption invalidation and save.
   * This is the atomic operation that MCP tools currently do in 3 steps.
   */
  async recordChanges(params: RecordChangesParams): Promise<RecordChangesResult> {
    const runId = `api-${Date.now()}`;

    // 1. Record the changes
    this.contextManager.changes.recordChanges(
      runId,
      params.files.map((file) => ({
        file,
        operation: params.operation,
        reason: params.reason,
      }))
    );

    // 2. Check for invalidated assumptions
    const invalidated = this.contextManager.assumptions.checkInvalidations(params.files, runId);

    // 3. Persist
    this.contextManager.save();

    return {
      recorded: params.files.length,
      invalidated,
    };
  }

  /**
   * Perform pre-flight context check (dependencies + assumptions).
   */
  preflightCheck(workspacePath: string): {
    hasDependencyChanges: boolean;
    dependencyDiff: DependencyDiff | null;
    conflictingAssumptions: Assumption[];
  } {
    const dependencyDiff = this.contextManager.checkDependencies(workspacePath);
    const invalidated = this.contextManager.assumptions.getRecentlyInvalidated();

    return {
      hasDependencyChanges: dependencyDiff !== null && dependencyDiff.hasChanges,
      dependencyDiff,
      conflictingAssumptions: invalidated,
    };
  }
}
