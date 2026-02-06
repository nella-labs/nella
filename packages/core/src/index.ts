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
// Main API
// =============================================================================

export { runTask, check, validate } from "./run";
export type { RunTaskOptions, RunResultWithContext } from "./run";

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
  // Components
  Chunker,
  createChunker,
  Embedder,
  createEmbedder,
  EmbeddingCacheManager,
  VectorStore,
  createVectorStore,
  LexicalIndex,
  createLexicalIndex,
  HybridSearcher,
  createHybridSearcher,
  CodeVerifier,
  createCodeVerifier,
} from "./indexing";

export type {
  // Types
  CodeChunk,
  ChunkType,
  CodeSymbol,
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
// Auth (API Keys & Agents)
// =============================================================================

export {
  // Key Manager
  KeyManager,
  createKeyManager,
  // Agent Manager
  AgentManager,
  createAgentManager,
  // Authenticator
  Authenticator,
  createAuthenticator,
  // Constants
  DEFAULT_RATE_LIMIT,
  DEFAULT_PERMISSIONS,
  ADMIN_PERMISSIONS,
  DEFAULT_KEY_STORE_SETTINGS,
} from "./auth";

export type {
  // Types
  ApiKey,
  ApiKeyPermissions,
  RateLimitConfig,
  Agent,
  AgentType,
  AgentConfig,
  AuthRequest,
  AuthAction,
  AuthResult,
  AuthErrorCode,
  KeyStore,
  KeyStoreSettings,
  AuthEvent,
  // Options
  CreateKeyOptions,
  CreateAgentOptions,
  AuthenticatorOptions,
  // Event handlers
  KeyEventHandler,
  AgentEventHandler,
} from "./auth";

// =============================================================================
// Rate Limiting
// =============================================================================

export {
  RateLimiter,
  createRateLimiter,
  getRateLimiter,
  DEFAULT_RATE_LIMITER_CONFIG,
  DEFAULT_PRIORITY_CONFIG,
  DEFAULT_DYNAMIC_LIMITS_CONFIG,
  DEFAULT_GRACEFUL_DEGRADATION_CONFIG,
  RATE_WINDOWS,
  MemoryBackend,
  RedisBackend,
  SQLiteBackend,
  createBackend,
  SlidingWindowAlgorithm,
  TokenBucketAlgorithm,
  createAlgorithm,
  generateHeaders,
  PriorityHandler,
  DynamicLimitAdjuster,
} from "./rate-limit";

export type {
  RateLimitWindow,
  RateLimitBucket,
  RateLimitState,
  RateLimitResult,
  RateLimiterConfig,
  RateLimitEvent,
  RateLimitEventHandler,
  RateLimitHeaders,
  RateLimitBackend,
  RateLimitAlgorithm,
  BackendType,
  RedisOptions,
  AlgorithmType,
  TokenBucketConfig,
  RequestPriority,
  PriorityConfig,
  DynamicLimitsConfig,
  GracefulDegradationConfig,
  RequestInfo as RateLimitRequestInfo,
} from "./rate-limit";

// =============================================================================
// Context Sharing
// =============================================================================

export {
  ContextManager as SharedContextManager,
  createContextManager as createSharedContextManager,
  DEFAULT_CHANNEL_SETTINGS,
  DEFAULT_CONTEXT_TTL,
} from "./context-sharing";

export type {
  ContextEntry,
  ContextType,
  ContextVisibility,
  ContextChannel,
  ContextQuery,
  ContextQueryResult,
  ContextEvent,
  ContextStore,
  CodeSnippetContext,
  DecisionContext,
  DependencyContext,
  SetContextOptions,
  ContextEventHandler,
} from "./context-sharing";

// =============================================================================
// Cloud Sync
// =============================================================================

export {
  SyncManager,
  initSync,
  getSyncStatus,
  disconnectSync,
  LocalSyncAdapter,
  SupabaseSyncAdapter,
  GCPSyncAdapter,
  createLocalAdapter,
  createSupabaseAdapter,
  createGCPAdapter,
} from "./sync";

export type {
  SyncAdapter,
  SyncConfig,
  SyncStatus,
  SyncEvent,
  Workspace as SyncWorkspace,
  IndexedFile,
  Chunk,
  SearchResult as SyncSearchResult,
  CreateWorkspaceParams,
  UpsertFileParams,
  UpsertChunkParams,
  VectorSearchParams,
  TextSearchParams,
  HybridSearchParams,
} from "./sync";

// =============================================================================
// MCP Tools
// =============================================================================

export {
  McpToolHandler,
  createMcpToolHandler,
  NELLA_TOOLS,
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
  ToolCallMetadata,
  McpEvent,
  ToolHandlerConfig,
  McpEventHandler,
} from "./mcp";

// =============================================================================
// Export
// =============================================================================

export {
  ExportManager,
  createExportManager,
  DEFAULT_EXPORT_INCLUDE,
  DEFAULT_EXPORT_OPTIONS,
} from "./export";

export type {
  ExportFormat,
  ExportConfig,
  ExportInclude,
  ExportOptions,
  ToolCallExport,
  SearchExport,
  VerifyExport,
  ExportBundle,
  ExportEvent,
  ExportEventHandler,
} from "./export";

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
