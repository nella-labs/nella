/**
 * Nella - Reliability layer for coding agents
 * 
 * CLI + MCP Server unified package
 */

// =============================================================================
// Core API — Task Execution
// =============================================================================

export { runTask, check, validate } from "@usenella/core";
export type { RunTaskOptions, RunResultWithContext } from "@usenella/core";

// =============================================================================
// Types
// =============================================================================

export type {
  Task,
  RawTaskYaml,
  Changes,
  FileChange,
  Constraint,
  RunResult,
  ValidationResult,
} from "@usenella/core";

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
  checkScope,
  runCommand,
  runValidation,
  getValidationErrors,
  calculateValidationIntegrity,
} from "@usenella/core";

// =============================================================================
// Safety
// =============================================================================

export {
  shouldRefuse,
  detectRiskPatterns,
  detectRefusalInResponse,
  checkPrerequisites,
  checkRefusalCorrectness,
} from "@usenella/core";

export type {
  PrerequisiteCheck,
  RefusalCheckOptions,
} from "@usenella/core";

// =============================================================================
// Context (Stateful Tracking)
// =============================================================================

export {
  SessionStore,
  DependencyTracker,
  AssumptionTracker,
  ChangeLedger,
  ContextManager,
} from "@usenella/core";

export type {
  AssumptionType,
  DependencyChange,
} from "@usenella/core";

// =============================================================================
// Utilities
// =============================================================================

export {
  RunLogger,
  generateRunId,
  createTempWorkspace,
  applyChanges,
  getDiff,
  getModifiedFiles,
  createNellaDir,
  writeArtifacts,
  cleanupTempWorkspace,
} from "@usenella/core";

// =============================================================================
// Indexing (RAG System) — High-level factory API only
// =============================================================================

export {
  IndexManager,
  createIndexManager,
  createHybridSearcher,
  createCodeVerifier,
} from "@usenella/core";

export type {
  CodeChunk,
  SearchQuery,
  SearchResult,
  SearchResponse,
  IndexConfig,
  VerifyCodeRequest,
  VerifyCodeResult,
} from "@usenella/core";

// =============================================================================
// Workspace — Registry and Switcher API
// =============================================================================

export {
  WorkspaceRegistry,
  getWorkspaceRegistry,
  createWorkspaceRegistry,
  Workspace,
  WorkspaceSwitcher,
  getWorkspaceSwitcher,
  createWorkspaceSwitcher,
} from "@usenella/core";

export type {
  WorkspaceEntry,
  WorkspaceConfig,
  WorkspaceOptions,
} from "@usenella/core";

// =============================================================================
// MCP Tools — Public tool handler API
// =============================================================================

export {
  McpToolHandler,
  createMcpToolHandler,
  NELLA_TOOLS,
  validateToolInput,
} from "@usenella/core";

export type {
  McpTool,
  McpToolCall,
  McpToolResult,
  ToolHandlerConfig,
} from "@usenella/core";

// =============================================================================
// Services — High-level service layer
// =============================================================================

export {
  ValidationService,
  SafetyService,
  ContextService,
  SearchService,
  WorkspaceService,
} from "@usenella/core";

// =============================================================================
// MCP Server (nella-specific)
// =============================================================================

export { startMcpServer, type ServerContext } from "./mcp/server";
export {
  registerValidationTools,
  handleValidationTool,
  registerSafetyTools,
  handleSafetyTool,
  registerContextTools,
  handleContextTool,
} from "./mcp/tools";
