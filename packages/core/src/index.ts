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
  createKeyManagerFromEnv,
  // Agent Manager
  AgentManager,
  createAgentManager,
  // Authenticator
  Authenticator,
  createAuthenticator,
  // Token Manager (JWT)
  TokenManager,
  getTokenManager,
  createTokenManager,
  resetTokenManager,
  // Audit Log
  AuditLogManager,
  getAuditLog,
  createAuditLog,
  resetAuditLog,
  // Middleware (IP Filter & Request Signing)
  IPFilter,
  RequestSigner,
  getIPFilter,
  getRequestSigner,
  createIPFilterMiddleware,
  createSigningMiddleware,
  resetMiddleware,
  // Constants
  DEFAULT_RATE_LIMIT,
  DEFAULT_PERMISSIONS,
  ADMIN_PERMISSIONS,
  DEFAULT_KEY_STORE_SETTINGS,
  DEFAULT_JWT_CONFIG,
  DEFAULT_AUDIT_CONFIG,
  DEFAULT_ROTATION_POLICY,
  DEFAULT_IP_WHITELIST,
  DEFAULT_REQUEST_SIGNING,
} from "./auth";

export type {
  // Core types
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
  // JWT types
  JWTPayload,
  JWTConfig,
  // Audit types
  AuditEntry,
  AuditCategory,
  AuditLogConfig,
  // Rotation types
  RotationPolicy,
  RotationEvent,
  // Middleware types
  IPWhitelistConfig,
  RequestSigningConfig,
  SignedRequestHeaders,
  // Extended event type
  ExtendedAuthEvent,
  // Options
  CreateKeyOptions,
  CreateAgentOptions,
  AuthenticatorOptions,
  KeyManagerOptions,
  TokenManagerOptions,
  TokenResult,
  TokenValidationResult,
  AuditLogOptions,
  IPValidationResult,
  SignatureValidationResult,
  // Event handlers
  KeyEventHandler,
  AgentEventHandler,
  TokenEventHandler,
  AuditEventHandler,
  MiddlewareEventHandler,
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
  DEFAULT_MAX_VERSIONS,
  DEFAULT_CLEANUP_INTERVAL_MS,
  DEFAULT_EXPIRING_WARNING_MS,
  ContextConflictError,
  ContextValidationError,
  LocalTransport,
  SupabaseTransport,
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
  ContextVersion,
  ContextSchema,
  SchemaValidationResult,
  ContextSearchOptions,
  ContextSnapshot,
  ImportStrategy,
  CodeSnippetContext,
  DecisionContext,
  DependencyContext,
  SetContextOptions,
  ContextManagerOptions,
  ContextEventHandler,
  ContextTransport,
  ContextMessage,
  ChannelHandler,
} from "./context-sharing";

// =============================================================================
// Cloud Sync
// =============================================================================

export {
  SyncManager,
  initSync,
  getSyncStatus,
  disconnectSync,
  DEFAULT_CLOUD_SYNC_OPTIONS,
  LocalSyncAdapter,
  SupabaseSyncAdapter,
  GCPSyncAdapter,
  createLocalAdapter,
  createSupabaseAdapter,
  createGCPAdapter,
  createWorkspaceCloudSyncManager,
} from "./sync";

export type {
  SyncAdapter,
  SyncConfig,
  ConflictResolution as SyncConflictResolution,
  CloudSyncMode,
  CloudSyncOptions,
  CloudSyncRunStatus,
  CloudSyncFileStatus,
  CloudSyncFileState,
  CloudSyncPendingChange,
  CloudSyncConflict,
  CloudSyncStats,
  CloudSyncHistoryEntry,
  CloudSyncState,
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
  CloudObjectStorage,
  FileManifest,
  DeltaChunk,
  LocalManifestWithChunks,
} from "./sync";

// Legacy Cloud Sync Compatibility
export { CloudSyncManager, createCloudSyncManager } from "./cloud-sync/manager";
export type {
  CloudSyncConfig,
  ConflictResolution,
  SyncFileState,
  PendingChange,
  SyncHistoryEntry,
  SyncStats as LegacyCloudSyncStats,
  SyncState as LegacyCloudSyncState,
  SyncEvent as LegacyCloudSyncEvent,
  SyncError as LegacyCloudSyncError,
} from "./cloud-sync/types";

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

// =============================================================================
// Agents Module
// =============================================================================

export { AgentRunner, createAgentAdapter, AgentAdapter, AnthropicAdapter, OpenAIAdapter, MODEL_PRICING, estimateAgentCost } from "./agents";

export type {
  AgentProvider as LLMAgentProvider,
  AgentConfig as LLMAgentConfig,
  AgentMessage,
  ToolUseRequest,
  ToolDefinition,
  TokenUsage as AgentTokenUsage,
  LLMCallResult,
  AgentStatus,
  AgentRunConfig,
  AgentTurn,
  AgentRunResult,
  AgentRunnerEvent,
  AgentRunnerEventHandler,
  LLMCallOptions,
} from "./agents";
