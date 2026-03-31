/**
 * Nella Core
 *
 * Codebase intelligence for coding agents — addresses four areas:
 *
 * 1. Hallucination Reduction
 *    - Code verification against indexed codebase (imports, symbols, APIs)
 *    - Search returns only real code from the project
 *
 * 2. Context Expansion
 *    - Persistent session tracking across conversations
 *    - Assumption tracking with automatic invalidation
 *    - Change ledger and dependency drift detection
 *
 * 3. Prompt Injection Protection
 *    - Risk pattern detection (credential exposure, security bypass, backdoors)
 *    - Refusal recommendation for dangerous prompts
 *    - Constraint enforcement on forbidden files and patterns
 *
 * 4. Contradiction & Unbacked Behavior Prevention
 *    - Assumption conflict detection before changes
 *    - Scope creep analysis against declared plans
 *    - Symbol verification ensures code references real codebase entities
 *
 * @packageDocumentation
 */

// =============================================================================
// Types
// =============================================================================

export * from "./types";

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

// =============================================================================
// Context (Stateful Tracking)
// =============================================================================

export {
  SessionStore,
  DependencyTracker,
  AssumptionTracker,
  ChangeLedger,
  ContextManager,
} from "./context";

// =============================================================================
// Indexing (RAG System)
// =============================================================================

export {
  // Main manager
  IndexManager,
  createIndexManager,
  // Config defaults
  DEFAULT_INDEX_CONFIG,
  DEFAULT_EMBEDDING_MODEL,
  MODEL_DIMENSIONS,
  // Components (high-level)
  HybridSearcher,
  createHybridSearcher,
  CodeVerifier,
  createCodeVerifier,
  // Content scanning (prompt injection defense)
  scanContent,
  formatInjectionWarning,
  // Injection heuristic scoring
  scoreInjectionRisk,
  // HMAC signing (prompt injection defense L4)
  deriveHmacKey,
  signResultHmac,
  verifyResultHmac,
  signResponseHmac,
  verifyResponseHmac,
  // Dependency graph
  buildDependencyGraph,
  dependencyGraphToArchgraphModel,
} from "./indexing";

export {
  // Branch-aware indexing
  BranchIndexManager,
  createBranchIndexManager,
} from "./indexing/branch-manager";

export type {
  BranchIndexConfig,
} from "./indexing/branch-manager";

// =============================================================================
// Git Utilities
// =============================================================================

export * as gitUtils from "./utils/git";

// =============================================================================
// GitHub Integration
// =============================================================================

// =============================================================================
// Context Sharing (Multi-Agent Coordination)
// =============================================================================

export {
  AgentRegistry,
} from "./context-sharing";

export type {
  AgentPresence,
  AgentTask,
  AgentDecision,
  AgentRegistryEvent,
  FileConflict,
  AgentType,
  AgentStatus,
  TaskStatus,
  AgentRegistryOptions,
} from "./context-sharing";

// =============================================================================
// Cloud Sync (Branch + Agent)
// =============================================================================

export { BranchCloudSync } from "./sync/cloud/branch-sync";
export type { BranchCloudSyncConfig } from "./sync/cloud/branch-sync";

export { AgentStateSync } from "./sync/cloud/agent-sync";
export type { AgentStateSyncConfig, IndexUpdateNotification } from "./sync/cloud/agent-sync";

export { GitHubService, WebhookHandler } from "./github";

export type {
  GitHubRepoLink,
  GitHubWebhookEvent,
  GitHubWebhookPayload,
  GitHubFileChange,
  GitHubAppConfig,
  GitHubIndexAction,
  GitHubIndexJobData,
  JobQueue,
  RepoLinkStore,
  WebhookHandlerDeps,
  WebhookResult,
} from "./github";

export type {
  // Types
  IndexManagerConfig,
  CodeChunk,
  ChunkType,
  CodeSymbol,
  ContentSource,
  IndexMetadata,
  IndexConfig,
  SearchQuery,
  SearchFilter,
  SearchResult,
  SearchResponse,
  VerifyCodeRequest,
  VerifyCodeResult,
  VerifyIssue,
  EmbeddingRequest,
  EmbeddingResponse,
  EmbedderConfig as IndexEmbedderConfig,
  IndexEvent,
  ScanResult,
  DetectedPattern,
  InjectionPatternType,
  PatternSeverity,
  HmacSignature,
  SignedResult,
  InjectionAssessment,
  ScoringFactor,
  FileNode,
  DependencyEdge,
  DependencyGraph,
  GraphOptions,
} from "./indexing";

// =============================================================================
// Workspace (Multi-workspace Management)
// =============================================================================

export {
  // Registry
  WorkspaceRegistry,
  getWorkspaceRegistry,
  createWorkspaceRegistry,
  // Workspace
  Workspace,
  // Switcher
  WorkspaceSwitcher,
  getWorkspaceSwitcher,
  createWorkspaceSwitcher,
  // Constants
  DEFAULT_WORKSPACE_CONFIG,
  DEFAULT_REGISTRY_SETTINGS,
} from "./workspace";

export type {
  // Types
  WorkspaceEntry,
  WorkspaceConfig,
  IWorkspaceRegistry,
  RegistrySettings,
  WorkspaceEvent,
  GitBranchTracking,
  BranchIndexInfo,
  // Options
  WorkspaceOptions,
  SharedContext,
  SwitcherOptions,
  // Event handlers
  WorkspaceEventHandler,
  RegistryEventHandler,
  SwitcherEventHandler,
} from "./workspace";

// =============================================================================
// MCP Tools
// =============================================================================

export {
  McpToolHandler,
  createMcpToolHandler,
  NELLA_TOOLS,
  // Phase 7 additions
  validateToolInput,
  assertValidToolInput,
  McpError,
  ToolValidationError,
  ToolTimeoutError,
  AuthenticationError as McpAuthenticationError,
  RateLimitError as McpRateLimitError,
  ChainDepthError,
  UnknownToolError,
  RetryExhaustedError,
  retryWithBackoff,
  ToolResultCache,
  TelemetryManager,
  createTelemetryManager,
  ToolRegistry,
  createToolRegistry,
} from "./mcp";

export type {
  McpTool,
  McpToolParameter,
  McpToolCall,
  McpToolResult,
  SearchToolArgs,
  VerifyToolArgs,
  IndexToolArgs,
  GetContextToolArgs,
  SetContextToolArgs,
  ExplainToolArgs,
  DocsToolArgs,
  HistoryToolArgs,
  ToolCallMetadata,
  McpEvent,
  ToolHandlerConfig,
  McpEventHandler,
  ToolCategory,
  ToolExample,
  ProgressCallback,
  ToolInputValidationResult,
  ValidationErrorDetail,
  RetryOptions,
  RetryResult,
  ToolResultCacheConfig,
  TelemetryConfig,
  ToolSpan,
  ToolMetrics,
  ToolRegistryEntry,
  ToolFilter,
} from "./mcp";

// =============================================================================
// Playground Module
// =============================================================================

export { PlaygroundServer, createPlaygroundServer, DEFAULT_SERVER_CONFIG, DEFAULT_COST_CONFIG } from "./playground";

export type {
  PlaygroundServerConfig,
  PlaygroundSession,
  SessionState,
  ChainOfThoughtEntry,
  ToolCallEntry,
  SearchEntry,
  ClientMessage,
  ServerMessage,
  CostConfig,
  WebSocketClient,
  ServerEventHandlers,
} from "./playground";

// =============================================================================
// Services (Shared Service Layer)
// =============================================================================

export {
  ContextService,
  SearchService,
  WorkspaceService,
  AuthService,
} from "./services";

export type {
  AddAssumptionParams,
  RecordChangesParams,
  RecordChangesResult,
  SearchParams,
  SearchServiceConfig,
  CreateWorkspaceParams as ServiceCreateWorkspaceParams,
  WorkspaceInfo,
  AuthenticateResult,
  CreateApiKeyParams,
} from "./services";

// =============================================================================
// Agents (LLM Agent Integration)
// =============================================================================

export {
  AgentRunner,
  createAgentAdapter,
  AnthropicAdapter,
  OpenAIAdapter,
  AzureOpenAIAdapter,
  AgentAdapter,
} from "./agents";

export type {
  AgentRunConfig,
  AgentRunResult,
  AgentTurn,
  AgentConfig,
  AgentMessage,
  ToolUseRequest,
  ToolDefinition,
  TokenUsage,
  AgentProvider,
  AgentRunnerEvent,
  AgentRunnerEventHandler,
  LLMCallOptions,
} from "./agents";
