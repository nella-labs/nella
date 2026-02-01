# Nella Core - Implementation Roadmap & Improvements

This document tracks all work-in-progress items, improvements, and future enhancements for the 10 phases of nella core implementation.

---

## Phase 1: Indexing Module (`packages/core/src/indexing/`)

### ✅ Completed
- [x] Types definition (`types.ts`)
- [x] Embedder with Voyage/OpenAI support (`embedder.ts`)
- [x] AST-aware code chunker (`chunker.ts`)
- [x] Vector store with persistence (`vector-store.ts`)
- [x] Lexical index with BM25 (`lexical-index.ts`)
- [x] Hybrid search with RRF (`hybrid-search.ts`)
- [x] Code verifier (`verifier.ts`)
- [x] Index manager orchestration (`index.ts`)

### 🔧 Improvements Needed

#### Vector Store (`vector-store.ts`)
- [ ] **HNSW Integration**: Replace brute-force cosine similarity with actual HNSW
  - Install `usearch` or `hnswlib-node` as optional dependency
  - Create adapter pattern for pluggable vector backends
  - Add benchmark tests for 10k, 100k, 1M vectors
- [ ] **Memory Optimization**: Implement vector quantization (e.g., int8)
- [ ] **Incremental Save**: Don't rewrite entire index on each save
- [ ] **Sharding**: Support splitting large indices across multiple files
- [ ] **Distance Metrics**: Support Euclidean and dot product in addition to cosine

#### Embedder (`embedder.ts`)
- [ ] **Batch Processing**: Implement proper batch queue with rate limiting
- [ ] **Retry Logic**: Add exponential backoff for API failures
- [ ] **Local Embeddings**: Add support for local models (e.g., ONNX runtime)
- [ ] **Cache Improvements**: Use SQLite instead of JSON for large caches
- [ ] **Provider Abstraction**: Create proper EmbeddingProvider interface
- [ ] **Cost Tracking**: Track actual API costs per workspace

#### Chunker (`chunker.ts`)
- [ ] **Real AST Parsing**: Replace regex with `@typescript-eslint/parser`
- [ ] **Language Support**: Add chunkers for:
  - Python (ast module integration)
  - Go
  - Rust
  - Java
- [ ] **Semantic Chunking**: Use embedding similarity for smart boundaries
- [ ] **Chunk Deduplication**: Detect and skip duplicate content
- [ ] **Documentation Extraction**: Extract JSDoc/docstrings separately

#### Lexical Index (`lexical-index.ts`)
- [ ] **Stemming**: Add Porter Stemmer for better recall
- [ ] **Synonyms**: Support synonym expansion
- [ ] **Fuzzy Search**: Add n-gram based fuzzy matching
- [ ] **Performance**: Use more efficient inverted index structure
- [ ] **Phrase Queries**: Support "exact phrase" searches

#### Hybrid Search (`hybrid-search.ts`)
- [ ] **Reranking**: Integrate Cohere Rerank or similar
- [ ] **Query Expansion**: Automatic synonym/related term expansion
- [ ] **Personalization**: Learn from user feedback
- [ ] **Filters**: Add support for complex filter expressions
- [ ] **Faceted Search**: Return aggregations by file type, language, etc.

#### Verifier (`verifier.ts`)
- [ ] **TypeScript Type Checking**: Use TypeScript compiler API
- [ ] **Scope Analysis**: Understand variable scoping
- [ ] **Import Resolution**: Actually resolve import paths
- [ ] **API Signature Matching**: Compare function signatures
- [ ] **Suggestions Engine**: Improve suggestion quality with ML

---

## Phase 2: Workspace Module (`packages/core/src/workspace/`)

### ✅ Completed
- [x] Types definition (`types.ts`)
- [x] Workspace registry (`registry.ts`)
- [x] Workspace class (`workspace.ts`)
- [x] Workspace switcher (`switcher.ts`)

### 🔧 Improvements Needed

#### Registry (`registry.ts`)
- [ ] **File Locking**: Prevent race conditions on registry.json
- [ ] **Backup/Restore**: Auto-backup registry before modifications
- [ ] **Migration Support**: Version registry format with migrations
- [ ] **Workspace Validation**: Verify workspace paths still exist
- [ ] **Import/Export**: Allow exporting workspace configs

#### Workspace (`workspace.ts`)
- [ ] **Watch Mode**: File system watcher for auto-reindex
- [ ] **Lazy Loading**: Don't load index until actually needed
- [ ] **Memory Management**: Unload index when memory pressure detected
- [ ] **Conflict Resolution**: Handle concurrent workspace modifications
- [ ] **Metrics Collection**: Track workspace usage statistics

#### Switcher (`switcher.ts`)
- [ ] **Preloading**: Predictively load likely next workspaces
- [ ] **LRU Cache**: Proper LRU eviction for workspace cache
- [ ] **Graceful Shutdown**: Save state on process exit
- [ ] **Cross-Process Sync**: Handle multiple nella instances

---

## Phase 3: Auth Module (`packages/core/src/auth/`)

### ✅ Completed
- [x] Types definition (`types.ts`)
- [x] API key manager (`key-manager.ts`)
- [x] Agent manager (`agent-manager.ts`)
- [x] Authenticator (`authenticator.ts`)

### 🔧 Improvements Needed

#### Key Manager (`key-manager.ts`)
- [ ] **Key Encryption**: Encrypt stored keys at rest (AES-256)
- [ ] **Key Rotation**: Automatic rotation with overlap period
- [ ] **Audit Logging**: Track all key operations
- [ ] **Revocation Lists**: Maintain revoked key hashes
- [ ] **Scope-Based Permissions**: More granular permission system

#### Agent Manager (`agent-manager.ts`)
- [ ] **Dynamic Agent Registration**: Allow runtime agent registration
- [ ] **Agent Templates**: Pre-defined templates for common agents
- [ ] **Usage Quotas**: Per-agent usage limits beyond rate limiting
- [ ] **Agent Groups**: Group agents for team management
- [ ] **Service Accounts**: Support for automated/CI agents

#### Authenticator (`authenticator.ts`)
- [ ] **Token-Based Auth**: Support JWT tokens for sessions
- [ ] **OAuth Integration**: Support OAuth2 for enterprise
- [ ] **MFA Support**: Optional two-factor authentication
- [ ] **IP Whitelisting**: Restrict by IP address
- [ ] **Request Signing**: HMAC-based request signing

---

## Phase 4: Rate Limit Module (`packages/core/src/rate-limit/`)

### ✅ Completed
- [x] Types definition (`types.ts`)
- [x] Rate limiter (`limiter.ts`)

### 🔧 Improvements Needed

#### Limiter (`limiter.ts`)
- [ ] **Redis Backend**: Support distributed rate limiting
- [ ] **Token Bucket Algorithm**: Add as alternative to sliding window
- [ ] **Dynamic Limits**: Adjust limits based on load
- [ ] **Priority Queuing**: Allow priority requests to bypass limits
- [ ] **Rate Limit Headers**: Return standard headers (X-RateLimit-*)
- [ ] **Graceful Degradation**: Soft limits with warnings before hard limits
- [ ] **Persistence**: Save/restore state across restarts

---

## Phase 5: Context Sharing Module (`packages/core/src/context-sharing/`)

### ✅ Completed
- [x] Types definition (`types.ts`)
- [x] Context manager (`manager.ts`)

### 🔧 Improvements Needed

#### Manager (`manager.ts`)
- [ ] **Context Channels**: Pub/sub for real-time context updates
- [ ] **Conflict Resolution**: Handle concurrent writes properly
- [ ] **Context Versioning**: Track history of context changes
- [ ] **Context Search**: Full-text search within context
- [ ] **Context Schemas**: Validate context values against schemas
- [ ] **Context Encryption**: Encrypt sensitive context values
- [ ] **Cross-Workspace Context**: Share context between workspaces
- [ ] **Context Expiration**: Background cleanup of expired entries
- [ ] **Context Import/Export**: Serialization for backup/restore

---

## Phase 6: Cloud Sync Module (`packages/core/src/cloud-sync/`)

### ✅ Completed
- [x] Types definition (`types.ts`)
- [x] Sync manager (`manager.ts`) - Mock implementation

### 🔧 Improvements Needed

#### Manager (`manager.ts`)
- [ ] **Actual GCS Integration**: Replace mock with real Google Cloud Storage
  - Use `@google-cloud/storage` SDK
  - Implement proper authentication (service account, user credentials)
- [ ] **AWS S3 Support**: Add S3 as alternative backend
- [ ] **Azure Blob Support**: Add Azure Blob Storage support
- [ ] **Delta Sync**: Only sync changed portions of files
- [ ] **Compression**: Compress data before upload
- [ ] **Bandwidth Throttling**: Limit upload/download speeds
- [ ] **Offline Mode**: Queue changes when offline
- [ ] **Conflict UI**: Visual diff for manual conflict resolution
- [ ] **Sync History**: Track sync operations for debugging
- [ ] **Selective Sync**: Allow excluding certain files/folders

---

## Phase 7: MCP Module (`packages/core/src/mcp/`)

### ✅ Completed
- [x] Types definition (`types.ts`)
- [x] Tool handler (`handler.ts`)
- [x] Tool definitions (6 tools)

### 🔧 Improvements Needed

#### Types (`types.ts`)
- [ ] **Additional Tools**: Add more tools:
  - `nella_explain`: Explain code snippets
  - `nella_refactor`: Suggest refactorings
  - `nella_test`: Generate test suggestions
  - `nella_docs`: Search documentation
  - `nella_history`: Query search history
- [ ] **Tool Versioning**: Support multiple tool versions
- [ ] **Tool Metadata**: Add categories, tags, examples

#### Handler (`handler.ts`)
- [ ] **Streaming Responses**: Support streaming for large results
- [ ] **Tool Chaining**: Allow tools to call other tools
- [ ] **Caching**: Cache identical tool calls
- [ ] **Telemetry**: OpenTelemetry integration
- [ ] **Timeouts**: Per-tool timeout configuration
- [ ] **Retry Logic**: Automatic retry for transient failures
- [ ] **Request Validation**: JSON Schema validation for inputs

---

## Phase 8: Export Module (`packages/core/src/export/`)

### ✅ Completed
- [x] Types definition (`types.ts`)
- [x] Export manager (`manager.ts`)
- [x] Formats: JSON, CSV, HTML, Markdown, OpenTelemetry

### 🔧 Improvements Needed

#### Manager (`manager.ts`)
- [ ] **PDF Export**: Add PDF export with proper styling
- [ ] **SARIF Export**: Security-focused report format
- [ ] **JUnit XML**: Test result format for CI/CD
- [ ] **Custom Templates**: Allow user-defined export templates
- [ ] **Incremental Export**: Export only changes since last export
- [ ] **Scheduled Exports**: Automatic periodic exports
- [ ] **Export Compression**: Zip/gzip large exports
- [ ] **Export Signing**: Digital signatures for audit trail
- [ ] **Streaming Export**: Handle large datasets without OOM

---

## Phase 9: Playground Server (`packages/core/src/playground/`)

### ✅ Completed
- [x] Types definition (`types.ts`)
- [x] Server (mock implementation) (`server.ts`)

### 🔧 Improvements Needed

#### Server (`server.ts`)
- [ ] **Real HTTP Server**: Implement with Express
  ```
  npm install express cors
  npm install -D @types/express @types/cors
  ```
- [ ] **Real WebSocket**: Implement with ws library
  ```
  npm install ws
  npm install -D @types/ws
  ```
- [ ] **Authentication Middleware**: Protect API endpoints
- [ ] **HTTPS Support**: TLS configuration
- [ ] **Health Checks**: `/health` and `/ready` endpoints
- [ ] **Metrics Endpoint**: Prometheus-compatible `/metrics`
- [ ] **Request Logging**: Structured logging with correlation IDs
- [ ] **Graceful Shutdown**: Drain connections on shutdown
- [ ] **Connection Pooling**: Limit concurrent connections
- [ ] **Session Persistence**: Save sessions to disk

---

## Phase 10: Dashboard UI (`packages/core/src/playground/dashboard.html`)

### ✅ Completed
- [x] Basic HTML/CSS/JS dashboard
- [x] WebSocket connection handling
- [x] Tool execution UI
- [x] Chain of thought visualization
- [x] Rate limit display

### 🔧 Improvements Needed

#### UI/UX
- [ ] **React Migration**: Move to React for better maintainability
- [ ] **TypeScript**: Type-safe dashboard code
- [ ] **Responsive Design**: Mobile-friendly layout
- [ ] **Dark/Light Theme**: Theme toggle
- [ ] **Keyboard Shortcuts**: Power user keyboard navigation
- [ ] **Accessibility**: WCAG 2.1 AA compliance

#### Features
- [ ] **Search Results Visualization**: Better code display with syntax highlighting
- [ ] **Index Progress**: Visual progress bar for indexing
- [ ] **Cost Dashboard**: Graphs and charts for cost over time
- [ ] **Session Management**: List/switch/delete sessions
- [ ] **Export UI**: One-click export buttons
- [ ] **Settings Panel**: Configure costs, rate limits, etc.
- [ ] **Error Log**: Searchable error history
- [ ] **Workspace Selector**: Switch between workspaces in UI

---

## Cross-Cutting Concerns

### Testing
- [ ] **Unit Tests**: Add comprehensive unit tests for all modules
- [ ] **Integration Tests**: Test module interactions
- [ ] **E2E Tests**: Full workflow tests
- [ ] **Performance Tests**: Benchmark critical paths
- [ ] **Load Tests**: Test under high load

### Documentation
- [ ] **API Documentation**: TypeDoc for all exports
- [ ] **Architecture Docs**: System design documentation
- [ ] **User Guide**: End-user documentation
- [ ] **Migration Guide**: Upgrading between versions
- [ ] **Troubleshooting Guide**: Common issues and solutions

### DevOps
- [ ] **CI/CD Pipeline**: GitHub Actions for testing/publishing
- [ ] **NPM Publishing**: Publish to npm registry
- [ ] **Changelog**: Automated changelog generation
- [ ] **Semantic Versioning**: Proper version management
- [ ] **Release Notes**: Per-release documentation

### Security
- [ ] **Security Audit**: Third-party security review
- [ ] **Dependency Scanning**: Automated vulnerability checks
- [ ] **SAST**: Static analysis security testing
- [ ] **Secrets Management**: No hardcoded secrets
- [ ] **Input Sanitization**: Prevent injection attacks

---

## Priority Matrix

### High Priority (Next Sprint)
1. Real HTTP/WebSocket server implementation
2. Unit tests for indexing module
3. Actual HNSW integration
4. Real GCS integration for cloud sync

### Medium Priority
1. React dashboard migration
2. Additional MCP tools
3. Redis rate limiting backend
4. Proper AST parsing

### Low Priority
1. PDF export
2. OAuth integration
3. Additional cloud storage backends
4. ML-based suggestions

---

## Notes

- All modules currently use mock implementations where external dependencies would be needed
- The codebase prioritizes type safety and clean interfaces for future enhancement
- Each module follows a consistent pattern: types.ts → implementation → index.ts
- Event-driven architecture allows loose coupling between modules
