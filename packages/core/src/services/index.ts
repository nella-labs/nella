/**
 * Shared Service Layer
 *
 * High-level business logic services consumed by both the REST API
 * (packages/api) and MCP tool handlers (packages/nella).
 *
 * Each service wraps one or more @usenella/core modules, providing:
 * - Simplified interfaces (hide Task/Changes construction boilerplate)
 * - Atomic operations (record + invalidate + save in one call)
 * - Consistent error handling
 *
 * @packageDocumentation
 */

export { ValidationService } from "./validation-service";
export type { ValidateConstraintsParams, RunFullTaskParams } from "./validation-service";

export { SafetyService } from "./safety-service";
export type { DetectRisksResult, RefusalCheckParams } from "./safety-service";

export { ContextService } from "./context-service";
export type { AddAssumptionParams, RecordChangesParams, RecordChangesResult } from "./context-service";

export { SearchService } from "./search-service";
export type { SearchParams, SearchServiceConfig } from "./search-service";

export { WorkspaceService } from "./workspace-service";
export type { CreateWorkspaceParams, WorkspaceInfo } from "./workspace-service";

export { AuthService } from "./auth-service";
export type { AuthenticateResult, CreateApiKeyParams } from "./auth-service";
