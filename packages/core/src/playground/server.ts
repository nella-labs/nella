/**
 * Playground Server
 *
 * Real-time WebSocket server for the nella playground.
 * Provides live updates for tool calls, chain of thought, cost tracking.
 */

import * as crypto from "crypto";
import type {
  PlaygroundServerConfig,
  PlaygroundSession,
  SessionState,
  ChainOfThoughtEntry,
  ToolCallEntry,
  SearchEntry,
  ClientMessage,
  ServerMessage,
  CostConfig,
} from "./types";
import { DEFAULT_SERVER_CONFIG, DEFAULT_COST_CONFIG } from "./types";
import { Workspace, WorkspaceRegistry, getWorkspaceRegistry } from "../workspace";
import { McpToolHandler, createMcpToolHandler } from "../mcp";
import { Authenticator, createAuthenticator } from "../auth";
import { RateLimiter, createRateLimiter } from "../rate-limit";
import { ContextManager, createContextManager } from "../context-sharing";

// =============================================================================
// Types
// =============================================================================

export interface WebSocketClient {
  id: string;
  sessionId: string | null;
  send: (message: ServerMessage) => void;
}

export interface ServerEventHandlers {
  onStart?: (port: number) => void;
  onStop?: () => void;
  onClientConnect?: (clientId: string) => void;
  onClientDisconnect?: (clientId: string) => void;
  onError?: (error: Error) => void;
}

// =============================================================================
// Session Manager
// =============================================================================

class SessionManager {
  private sessions: Map<string, PlaygroundSession> = new Map();
  private config: PlaygroundServerConfig;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: PlaygroundServerConfig) {
    this.config = config;
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  create(workspaceId: string): PlaygroundSession {
    // Check max sessions
    const workspaceSessions = Array.from(this.sessions.values()).filter(
      (s) => s.workspaceId === workspaceId
    );
    if (workspaceSessions.length >= this.config.maxSessions) {
      // Remove oldest
      const oldest = workspaceSessions.sort(
        (a, b) => new Date(a.lastActivity).getTime() - new Date(b.lastActivity).getTime()
      )[0];
      this.sessions.delete(oldest.id);
    }

    const session: PlaygroundSession = {
      id: `session_${crypto.randomBytes(8).toString("hex")}`,
      workspaceId,
      clients: [],
      state: this.createInitialState(),
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      metadata: {
        totalToolCalls: 0,
        totalTokens: 0,
        estimatedCost: 0,
      },
    };

    this.sessions.set(session.id, session);
    return session;
  }

  get(sessionId: string): PlaygroundSession | null {
    return this.sessions.get(sessionId) || null;
  }

  getOrCreate(workspaceId: string): PlaygroundSession {
    // Find existing session for workspace
    const existing = Array.from(this.sessions.values()).find(
      (s) => s.workspaceId === workspaceId
    );
    if (existing) {
      existing.lastActivity = new Date().toISOString();
      return existing;
    }
    return this.create(workspaceId);
  }

  addClient(sessionId: string, clientId: string): void {
    const session = this.sessions.get(sessionId);
    if (session && !session.clients.includes(clientId)) {
      session.clients.push(clientId);
      session.lastActivity = new Date().toISOString();
    }
  }

  removeClient(sessionId: string, clientId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.clients = session.clients.filter((c) => c !== clientId);
    }
  }

  updateState(sessionId: string, update: Partial<SessionState>): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.state = { ...session.state, ...update };
      session.lastActivity = new Date().toISOString();
    }
  }

  addChainOfThought(sessionId: string, entry: ChainOfThoughtEntry): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.state.chainOfThought.push(entry);
      // Keep last 100 entries
      if (session.state.chainOfThought.length > 100) {
        session.state.chainOfThought = session.state.chainOfThought.slice(-100);
      }
      session.lastActivity = new Date().toISOString();
    }
  }

  addToolCall(sessionId: string, entry: ToolCallEntry): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.state.recentToolCalls.push(entry);
      if (session.state.recentToolCalls.length > 50) {
        session.state.recentToolCalls = session.state.recentToolCalls.slice(-50);
      }
      session.metadata.totalToolCalls++;
      if (entry.tokens) {
        session.metadata.totalTokens += entry.tokens;
      }
      if (entry.cost) {
        session.metadata.estimatedCost += entry.cost;
      }
      session.lastActivity = new Date().toISOString();
    }
  }

  addSearch(sessionId: string, entry: SearchEntry): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.state.recentSearches.push(entry);
      if (session.state.recentSearches.length > 20) {
        session.state.recentSearches = session.state.recentSearches.slice(-20);
      }
      session.lastActivity = new Date().toISOString();
    }
  }

  clear(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.state = this.createInitialState();
      session.metadata = {
        totalToolCalls: 0,
        totalTokens: 0,
        estimatedCost: 0,
      };
    }
  }

  private createInitialState(): SessionState {
    return {
      activeAgent: null,
      chainOfThought: [],
      recentToolCalls: [],
      recentSearches: [],
      indexStatus: "none",
      rateLimitStatus: {
        minute: { used: 0, limit: 60 },
        hour: { used: 0, limit: 1000 },
      },
    };
  }

  private cleanup(): void {
    const now = Date.now();
    const timeout = this.config.sessionTimeout;

    for (const [id, session] of this.sessions.entries()) {
      const lastActivity = new Date(session.lastActivity).getTime();
      if (now - lastActivity > timeout && session.clients.length === 0) {
        this.sessions.delete(id);
      }
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.sessions.clear();
  }
}

// =============================================================================
// Playground Server Class
// =============================================================================

export class PlaygroundServer {
  private config: PlaygroundServerConfig;
  private sessionManager: SessionManager;
  private clients: Map<string, WebSocketClient> = new Map();
  private workspaces: Map<string, Workspace> = new Map();
  private toolHandlers: Map<string, McpToolHandler> = new Map();
  private registry: WorkspaceRegistry;
  private authenticator: Authenticator;
  private rateLimiter: RateLimiter;
  private contextManager: ContextManager;
  private costConfig: CostConfig;
  private isRunning: boolean = false;
  private eventHandlers: ServerEventHandlers = {};

  constructor(config: Partial<PlaygroundServerConfig> & { workspacePath: string; storagePath: string }) {
    this.config = { ...DEFAULT_SERVER_CONFIG, ...config };
    this.costConfig = DEFAULT_COST_CONFIG;
    this.sessionManager = new SessionManager(this.config);
    this.registry = getWorkspaceRegistry(this.config.storagePath);
    this.authenticator = createAuthenticator(this.config.storagePath);
    this.rateLimiter = createRateLimiter();
    this.contextManager = createContextManager(this.config.storagePath);
  }

  // =============================================================================
  // Event Handlers
  // =============================================================================

  on(handlers: ServerEventHandlers): void {
    this.eventHandlers = { ...this.eventHandlers, ...handlers };
  }

  // =============================================================================
  // Server Control
  // =============================================================================

  /**
   * Start the playground server
   * Note: This is a mock implementation. Real implementation would use express + ws
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error("Server is already running");
    }

    // In a real implementation:
    // const app = express();
    // const server = http.createServer(app);
    // const wss = new WebSocketServer({ server });
    // 
    // app.get('/health', (req, res) => res.json({ status: 'ok' }));
    // app.get('/api/session/:id', (req, res) => { ... });
    // 
    // wss.on('connection', (ws) => { ... });
    // 
    // server.listen(this.config.port, this.config.host);

    this.isRunning = true;
    console.log(`[Playground] Server started on http://${this.config.host}:${this.config.port}`);
    this.eventHandlers.onStart?.(this.config.port);
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    // Disconnect all clients
    for (const client of this.clients.values()) {
      this.handleDisconnect(client.id);
    }

    this.sessionManager.destroy();
    this.rateLimiter.destroy();
    this.contextManager.destroy();

    this.isRunning = false;
    console.log("[Playground] Server stopped");
    this.eventHandlers.onStop?.();
  }

  // =============================================================================
  // Client Management
  // =============================================================================

  /**
   * Handle new client connection
   */
  handleConnect(send: (message: ServerMessage) => void): string {
    const clientId = `client_${crypto.randomBytes(8).toString("hex")}`;
    
    const client: WebSocketClient = {
      id: clientId,
      sessionId: null,
      send,
    };

    this.clients.set(clientId, client);
    this.eventHandlers.onClientConnect?.(clientId);

    return clientId;
  }

  /**
   * Handle client disconnect
   */
  handleDisconnect(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client?.sessionId) {
      this.sessionManager.removeClient(client.sessionId, clientId);
    }
    this.clients.delete(clientId);
    this.eventHandlers.onClientDisconnect?.(clientId);
  }

  /**
   * Handle client message
   */
  async handleMessage(clientId: string, message: ClientMessage): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return;

    try {
      switch (message.type) {
        case "subscribe":
          await this.handleSubscribe(client, message.sessionId);
          break;
        case "unsubscribe":
          this.handleUnsubscribe(client, message.sessionId);
          break;
        case "tool:call":
          await this.handleToolCall(client, message.toolName, message.arguments);
          break;
        case "session:clear":
          this.handleSessionClear(client);
          break;
        case "index:start":
          await this.handleIndexStart(client, message.incremental);
          break;
        case "context:get":
          await this.handleContextGet(client, message.key);
          break;
        case "context:set":
          await this.handleContextSet(client, message.key, message.value);
          break;
      }
    } catch (error) {
      client.send({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // =============================================================================
  // Message Handlers
  // =============================================================================

  private async handleSubscribe(client: WebSocketClient, sessionId: string): Promise<void> {
    // Get or create session
    let session = this.sessionManager.get(sessionId);
    if (!session) {
      // Create new session for default workspace
      let workspace = this.workspaces.get(this.config.workspacePath);
      if (!workspace) {
        workspace = Workspace.fromPath(this.config.workspacePath, undefined, { registry: this.registry });
        this.workspaces.set(this.config.workspacePath, workspace);
      }
      session = this.sessionManager.create(workspace.id);
    }

    // Subscribe client
    client.sessionId = session.id;
    this.sessionManager.addClient(session.id, client.id);

    // Send current state
    client.send({
      type: "connected",
      sessionId: session.id,
      clientId: client.id,
    });

    client.send({
      type: "session:state",
      state: session.state,
    });
  }

  private handleUnsubscribe(client: WebSocketClient, sessionId: string): void {
    if (client.sessionId === sessionId) {
      this.sessionManager.removeClient(sessionId, client.id);
      client.sessionId = null;
    }
  }

  private async handleToolCall(
    client: WebSocketClient,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<void> {
    if (!client.sessionId) {
      throw new Error("Not subscribed to a session");
    }

    const session = this.sessionManager.get(client.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    const workspace = this.workspaces.get(this.config.workspacePath);
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    // Get or create tool handler
    let handler = this.toolHandlers.get(session.id);
    if (!handler) {
      handler = createMcpToolHandler({
        workspace,
        authenticator: this.config.authEnabled ? this.authenticator : undefined,
        rateLimiter: this.rateLimiter,
        contextManager: this.contextManager,
      });
      this.toolHandlers.set(session.id, handler);
    }

    const callId = `call_${crypto.randomBytes(8).toString("hex")}`;

    // Add chain of thought entry
    this.sessionManager.addChainOfThought(session.id, {
      id: crypto.randomBytes(4).toString("hex"),
      type: "action",
      content: `Calling ${toolName}(${JSON.stringify(args)})`,
      timestamp: new Date().toISOString(),
    });

    // Broadcast start
    this.broadcast(session.id, {
      type: "tool:start",
      callId,
      toolName,
    });

    // Execute tool
    const startTime = Date.now();
    const result = await handler.handleToolCall({
      name: toolName,
      arguments: args,
    });
    const duration = Date.now() - startTime;

    // Estimate tokens and cost
    const tokens = this.estimateTokens(args, result);
    const cost = this.estimateCost(tokens);

    // Create entry
    const entry: ToolCallEntry = {
      id: callId,
      toolName,
      arguments: args,
      result: result.content,
      success: !result.isError,
      error: result.isError ? result.content[0]?.text : undefined,
      duration,
      timestamp: new Date().toISOString(),
      tokens,
      cost,
    };

    // Update session
    this.sessionManager.addToolCall(session.id, entry);

    // Add observation
    this.sessionManager.addChainOfThought(session.id, {
      id: crypto.randomBytes(4).toString("hex"),
      type: "observation",
      content: result.isError
        ? `Error: ${result.content[0]?.text}`
        : `Result received (${duration}ms)`,
      timestamp: new Date().toISOString(),
      duration,
    });

    // Broadcast end
    this.broadcast(session.id, {
      type: "tool:end",
      callId,
      entry,
    });

    // Check rate limits
    const usage = this.rateLimiter.getUsage(workspace.id);
    if (usage) {
      this.sessionManager.updateState(session.id, {
        rateLimitStatus: {
          minute: usage.minute,
          hour: usage.hour,
        },
      });

      // Warn at 80%
      if (usage.minute.count / usage.minute.limit > 0.8) {
        this.broadcast(session.id, {
          type: "rate:warning",
          window: "minute",
          percentUsed: (usage.minute.count / usage.minute.limit) * 100,
        });
      }
    }
  }

  private handleSessionClear(client: WebSocketClient): void {
    if (!client.sessionId) return;

    this.sessionManager.clear(client.sessionId);
    
    const session = this.sessionManager.get(client.sessionId);
    if (session) {
      this.broadcast(session.id, {
        type: "session:state",
        state: session.state,
      });
    }
  }

  private async handleIndexStart(client: WebSocketClient, incremental?: boolean): Promise<void> {
    if (!client.sessionId) {
      throw new Error("Not subscribed to a session");
    }

    const session = this.sessionManager.get(client.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    const workspace = this.workspaces.get(this.config.workspacePath);
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    this.sessionManager.updateState(session.id, { indexStatus: "indexing" });
    this.broadcast(session.id, {
      type: "index:progress",
      percent: 0,
      status: "Starting indexing...",
    });

    try {
      await workspace.index({ incremental });

      const stats = workspace.stats;
      this.sessionManager.updateState(session.id, { indexStatus: "ready" });
      this.broadcast(session.id, {
        type: "index:complete",
        stats: {
          files: stats.filesIndexed,
          chunks: stats.chunksCount,
          tokens: stats.totalTokens,
        },
      });
    } catch (error) {
      this.sessionManager.updateState(session.id, { indexStatus: "error" });
      throw error;
    }
  }

  private async handleContextGet(client: WebSocketClient, key?: string): Promise<void> {
    // Implementation would use contextManager
  }

  private async handleContextSet(client: WebSocketClient, key: string, value: unknown): Promise<void> {
    // Implementation would use contextManager
  }

  // =============================================================================
  // Helpers
  // =============================================================================

  private broadcast(sessionId: string, message: ServerMessage): void {
    const session = this.sessionManager.get(sessionId);
    if (!session) return;

    for (const clientId of session.clients) {
      const client = this.clients.get(clientId);
      client?.send(message);
    }
  }

  private estimateTokens(args: Record<string, unknown>, result: { content: Array<{ text?: string }> }): number {
    const inputText = JSON.stringify(args);
    const outputText = result.content.map((c) => c.text || "").join("");
    
    // Rough estimate: 1 token ≈ 4 characters
    return Math.ceil((inputText.length + outputText.length) / 4);
  }

  private estimateCost(tokens: number): number {
    // Simplified: assume 50% input, 50% output
    const inputTokens = tokens / 2;
    const outputTokens = tokens / 2;
    
    return (
      (inputTokens / 1000) * this.costConfig.inputCostPer1k +
      (outputTokens / 1000) * this.costConfig.outputCostPer1k
    );
  }

  setCostConfig(config: Partial<CostConfig>): void {
    this.costConfig = { ...this.costConfig, ...config };
  }

  getStatus(): {
    running: boolean;
    clients: number;
    sessions: number;
  } {
    return {
      running: this.isRunning,
      clients: this.clients.size,
      sessions: this.sessionManager ? Array.from(this.clients.values()).filter((c) => c.sessionId).length : 0,
    };
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createPlaygroundServer(
  config: Partial<PlaygroundServerConfig> & { workspacePath: string; storagePath: string }
): PlaygroundServer {
  return new PlaygroundServer(config);
}
