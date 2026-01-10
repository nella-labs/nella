/**
 * Nella Core
 *
 * Reliability layer for coding agents.
 *
 * Core enforces behavioral contracts that prevent agents from:
 * - Contradicting prior intent/decisions
 * - Touching forbidden areas
 * - Pretending tests ran when they didn't
 * - Scope-creeping outside the declared plan
 * - Proceeding when prerequisites are missing
 *
 * @packageDocumentation
 */

// =============================================================================
// Main API
// =============================================================================

export { runTask, check, validate } from "./run";
export type { RunTaskOptions } from "./run";

// =============================================================================
// Types
// =============================================================================

export * from "./types";

// =============================================================================
// Validators
// =============================================================================

export {
  checkConstraints,
  checkConstraint,
  checkFilesNotToModify,
  checkForbiddenPatterns,
  getViolatedConstraints,
  countViolations,
} from "./validators/constraint-checker";

export {
  checkScope,
} from "./validators/scope-checker";

export {
  runCommand,
  runValidation,
  getValidationErrors,
  calculateValidationIntegrity,
} from "./validators/command-runner";

// =============================================================================
// Safety
// =============================================================================

export {
  shouldRefuse,
  detectRiskPatterns,
  detectRefusalInResponse,
  checkPrerequisites,
  checkRefusalCorrectness,
  RISK_PATTERNS,
  REFUSAL_RESPONSE_PATTERNS,
} from "./safety/refusal-detector";

export type {
  PrerequisiteCheck,
  RefusalCheckOptions,
} from "./safety/refusal-detector";

// =============================================================================
// Utilities
// =============================================================================

export {
  RunLogger,
  generateRunId,
} from "./utils/logger";

export {
  createTempWorkspace,
  applyChanges,
  getDiff,
  getModifiedFiles,
  createNellaDir,
  writeArtifacts,
  cleanupTempWorkspace,
} from "./utils/workspace";
