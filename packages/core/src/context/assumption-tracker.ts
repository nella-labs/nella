/**
 * Assumption Tracker
 *
 * Tracks assumptions the agent makes about the codebase and detects
 * when changes invalidate those assumptions.
 */

import { minimatch } from "minimatch";
import {
  Assumption,
  AssumptionType,
  AssumptionCheckResult,
  AssumptionConflict,
  ChangeRecord,
} from "../types";
import { SessionStore } from "./session-store";

/**
 * Normalize file path for comparison
 */
function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

/**
 * Check if a file matches any pattern in a list
 */
function matchesAnyPattern(file: string, patterns: string[]): boolean {
  const normalizedFile = normalizePath(file);
  return patterns.some((pattern) =>
    minimatch(normalizedFile, normalizePath(pattern), { nocase: true, dot: true })
  );
}

/**
 * Assumption Tracker - manages assumptions and detects invalidations
 */
export class AssumptionTracker {
  constructor(private session: SessionStore) {}

  /**
   * Add a new assumption
   */
  addAssumption(
    description: string,
    relatedFiles: string[],
    type: AssumptionType = "other",
    confidence: number = 0.8
  ): Assumption {
    return this.session.addAssumption({
      description,
      type,
      relatedFiles: relatedFiles.map(normalizePath),
      confidence,
    });
  }

  /**
   * Add a schema-related assumption (database, API)
   */
  addSchemaAssumption(description: string, relatedFiles: string[]): Assumption {
    return this.addAssumption(description, relatedFiles, "schema", 0.9);
  }

  /**
   * Add an interface/type assumption
   */
  addInterfaceAssumption(description: string, relatedFiles: string[]): Assumption {
    return this.addAssumption(description, relatedFiles, "interface", 0.85);
  }

  /**
   * Add a dependency assumption
   */
  addDependencyAssumption(description: string): Assumption {
    return this.addAssumption(description, ["package.json"], "dependency", 0.9);
  }

  /**
   * Add a behavior assumption (function/method behavior)
   */
  addBehaviorAssumption(description: string, relatedFiles: string[]): Assumption {
    return this.addAssumption(description, relatedFiles, "behavior", 0.7);
  }

  /**
   * Add a config assumption
   */
  addConfigAssumption(description: string, relatedFiles: string[]): Assumption {
    return this.addAssumption(description, relatedFiles, "config", 0.85);
  }

  /**
   * Add a structure assumption (file/folder)
   */
  addStructureAssumption(description: string, relatedFiles: string[]): Assumption {
    return this.addAssumption(description, relatedFiles, "structure", 0.95);
  }

  /**
   * Get all valid assumptions
   */
  getValidAssumptions(): Assumption[] {
    return this.session.getValidAssumptions();
  }

  /**
   * Get all invalidated assumptions
   */
  getInvalidatedAssumptions(): Assumption[] {
    return this.session.getInvalidatedAssumptions();
  }

  /**
   * Get assumptions by type
   */
  getAssumptionsByType(type: AssumptionType): Assumption[] {
    return this.session.getAllAssumptions().filter((a) => a.type === type);
  }

  /**
   * Get assumptions related to specific files
   */
  getAssumptionsForFiles(files: string[]): Assumption[] {
    return this.session.getAssumptionsForFiles(files);
  }

  /**
   * Check if file changes invalidate any assumptions
   */
  checkInvalidations(modifiedFiles: string[], runId: string): Assumption[] {
    const invalidated: Assumption[] = [];
    const normalizedFiles = modifiedFiles.map(normalizePath);

    for (const assumption of this.getValidAssumptions()) {
      // Check if any modified file matches the assumption's related files
      const affected = assumption.relatedFiles.some((relatedFile) => {
        // Check exact match
        if (normalizedFiles.includes(normalizePath(relatedFile))) {
          return true;
        }
        // Check glob pattern match
        return normalizedFiles.some((modified) =>
          matchesAnyPattern(modified, [relatedFile])
        );
      });

      if (affected) {
        const result = this.session.invalidateAssumption(
          assumption.id,
          runId,
          `File(s) modified: ${normalizedFiles.filter((f) =>
            matchesAnyPattern(f, assumption.relatedFiles)
          ).join(", ")}`
        );
        if (result) {
          invalidated.push(result);
        }
      }
    }

    return invalidated;
  }

  /**
   * Get assumptions that might conflict with planned changes
   */
  getConflicts(plannedFiles: string[]): AssumptionConflict[] {
    const conflicts: AssumptionConflict[] = [];
    const normalizedPlanned = plannedFiles.map(normalizePath);

    for (const assumption of this.getValidAssumptions()) {
      for (const plannedFile of normalizedPlanned) {
        const relatedToPlanned = assumption.relatedFiles.some((f) =>
          matchesAnyPattern(plannedFile, [normalizePath(f)]) ||
          normalizePath(f) === plannedFile
        );

        if (relatedToPlanned) {
          conflicts.push({
            assumption,
            plannedFile,
            severity: assumption.confidence >= 0.8 ? "error" : "warning",
            suggestion: this.generateSuggestion(assumption, plannedFile),
          });
        }
      }
    }

    return conflicts;
  }

  /**
   * Generate a suggestion for handling a conflict
   */
  private generateSuggestion(assumption: Assumption, plannedFile: string): string {
    switch (assumption.type) {
      case "schema":
        return `Verify that changes to ${plannedFile} don't break schema assumption: "${assumption.description}"`;
      case "interface":
        return `Check if interface changes in ${plannedFile} require updates elsewhere. Assumption: "${assumption.description}"`;
      case "dependency":
        return `Dependency assumption may be affected: "${assumption.description}". Run npm install after changes.`;
      case "behavior":
        return `Behavior assumption may be invalidated: "${assumption.description}". Update tests accordingly.`;
      case "config":
        return `Configuration assumption may need review: "${assumption.description}"`;
      case "structure":
        return `File structure assumption may be affected: "${assumption.description}"`;
      default:
        return `Review assumption before modifying ${plannedFile}: "${assumption.description}"`;
    }
  }

  /**
   * Full assumption check - validates all assumptions and detects conflicts
   */
  checkAll(
    modifiedFiles: string[],
    plannedFiles: string[],
    runId: string
  ): AssumptionCheckResult {
    const allAssumptions = this.session.getAllAssumptions();
    const previouslyInvalidated = allAssumptions.filter((a) => !a.valid);

    // Check for invalidations from modified files
    const newlyInvalidated = this.checkInvalidations(modifiedFiles, runId);

    // Get remaining valid assumptions
    const valid = this.getValidAssumptions();

    // Check for conflicts with planned files
    const conflicts = this.getConflicts(plannedFiles);

    return {
      totalChecked: allAssumptions.length,
      valid,
      newlyInvalidated,
      previouslyInvalidated,
      conflicts,
    };
  }

  /**
   * Manually invalidate an assumption
   */
  invalidate(id: string, runId: string, reason: string): Assumption | null {
    return this.session.invalidateAssumption(id, runId, reason);
  }

  /**
   * Revalidate an assumption (mark as valid again)
   */
  revalidate(id: string): Assumption | null {
    return this.session.revalidateAssumption(id);
  }

  /**
   * Clear all invalidated assumptions
   */
  clearInvalidated(): number {
    const invalidated = this.getInvalidatedAssumptions();
    let cleared = 0;

    for (const assumption of invalidated) {
      // Remove from session by filtering (we'd need to add this to session store)
      // For now, we'll revalidate them as a workaround
      if (this.revalidate(assumption.id)) {
        cleared++;
      }
    }

    return cleared;
  }

  /**
   * Get summary of assumption state
   */
  getSummary(): {
    total: number;
    valid: number;
    invalidated: number;
    byType: Record<AssumptionType, number>;
  } {
    const all = this.session.getAllAssumptions();
    const byType: Record<AssumptionType, number> = {
      schema: 0,
      interface: 0,
      dependency: 0,
      behavior: 0,
      config: 0,
      structure: 0,
      other: 0,
    };

    for (const a of all) {
      byType[a.type]++;
    }

    return {
      total: all.length,
      valid: all.filter((a) => a.valid).length,
      invalidated: all.filter((a) => !a.valid).length,
      byType,
    };
  }

  /**
   * Search assumptions by description
   */
  search(query: string): Assumption[] {
    const lowerQuery = query.toLowerCase();
    return this.session.getAllAssumptions().filter((a) =>
      a.description.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Get recently invalidated assumptions
   */
  getRecentlyInvalidated(limit: number = 10): Assumption[] {
    return this.getInvalidatedAssumptions()
      .filter((a) => a.invalidatedAt)
      .sort((a, b) => {
        const aTime = new Date(a.invalidatedAt!).getTime();
        const bTime = new Date(b.invalidatedAt!).getTime();
        return bTime - aTime;
      })
      .slice(0, limit);
  }

  /**
   * Create assumptions from change records
   * Infers what assumptions the agent might have made based on changes
   */
  inferFromChanges(changes: ChangeRecord[]): Assumption[] {
    const inferred: Assumption[] = [];

    for (const change of changes) {
      const file = normalizePath(change.file);

      // Infer schema assumptions from Prisma/database files
      if (file.includes("prisma/schema") || file.includes(".schema.")) {
        inferred.push(
          this.addSchemaAssumption(
            `Database schema in ${file} has specific structure`,
            [file]
          )
        );
      }

      // Infer interface assumptions from type definition files
      if (file.includes(".d.ts") || file.includes("types/")) {
        inferred.push(
          this.addInterfaceAssumption(
            `Type definitions in ${file} define expected interfaces`,
            [file]
          )
        );
      }

      // Infer config assumptions from config files
      if (
        file.includes("config") ||
        file.endsWith(".config.ts") ||
        file.endsWith(".config.js")
      ) {
        inferred.push(
          this.addConfigAssumption(
            `Configuration in ${file} sets expected values`,
            [file]
          )
        );
      }
    }

    return inferred;
  }
}
