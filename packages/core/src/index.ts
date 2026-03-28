/**
 * Nella Core
 *
 * Reliability layer for coding agents — addresses four problems:
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
