/**
 * Safety Service
 *
 * Wraps refusal detection, risk pattern scanning, and prerequisite checking.
 * Encapsulates Task construction that MCP safety tools currently do inline.
 */

import {
  shouldRefuse,
  detectRiskPatterns,
  checkPrerequisites,
  type PrerequisiteCheck,
  type RefusalCheckOptions,
} from "../safety/refusal-detector";

import type { Task, RefusalResult } from "../types";

// =============================================================================
// Types
// =============================================================================

export interface DetectRisksResult {
  risks: string[];
  hasRisks: boolean;
  count: number;
}

export interface RefusalCheckParams {
  taskId: string;
  prompt: string;
  workspacePath: string;
  skipPrerequisites?: boolean;
}

// =============================================================================
// Service
// =============================================================================

export class SafetyService {
  /**
   * Detect risk patterns in text content.
   */
  detectRisks(content: string): DetectRisksResult {
    const risks = detectRiskPatterns(content);
    return {
      risks,
      hasRisks: risks.length > 0,
      count: risks.length,
    };
  }

  /**
   * Determine if a task should be refused.
   * Constructs a minimal Task object from simplified params.
   */
  async shouldRefuse(params: RefusalCheckParams): Promise<RefusalResult> {
    const task: Task = {
      id: params.taskId,
      name: params.taskId,
      prompt: params.prompt,
      category: "feature",
      difficulty: "medium",
      fixture: params.workspacePath,
      constraints: [],
      validation: {},
      expected: {
        filesToModify: [],
        filesToIgnore: [],
      },
    };

    const options: RefusalCheckOptions = {
      skipPrerequisites: params.skipPrerequisites,
    };

    return shouldRefuse(task, params.workspacePath, options);
  }

  /**
   * Check workspace prerequisites.
   */
  async checkPrerequisites(workspacePath: string): Promise<PrerequisiteCheck[]> {
    return checkPrerequisites(workspacePath);
  }
}
