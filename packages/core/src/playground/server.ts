/**
 * Playground Server
 *
 * Real-time WebSocket server for the nella playground.
 * Provides live updates for tool calls, chain of thought, cost tracking.
 */

import * as crypto from "crypto";
import * as http from "http";
import * as https from "https";
import * as fs from "fs";
import * as path from "path";
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
import { createLogger, generateCorrelationId } from "./logger";
import type { Logger } from "./logger";
import { createPlaygroundMetrics } from "./metrics";
import type { PlaygroundMetrics } from "./metrics";
import { createAuthMiddleware } from "./middleware/auth";
import type { AuthMiddleware } from "./middleware/auth";
import { createSessionStore } from "./session-store";
import type { SessionStore } from "./session-store";

// Dynamic imports for express and ws (they may not be installed)
let express: typeof import("express") | null = null;
let WebSocketServer: typeof import("ws").WebSocketServer | null = null;

try {
  express = require("express");
  WebSocketServer = require("ws").WebSocketServer;
} catch {
  // Dependencies not installed - will throw on start()
}

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
  private authenticator: Authenticator | null = null;
  private rateLimiter: RateLimiter;
  private contextManager: ContextManager;
  private costConfig: CostConfig;
  private isRunning: boolean = false;
  private eventHandlers: ServerEventHandlers = {};
  private httpServer: http.Server | https.Server | null = null;
  private wss: InstanceType<typeof import("ws").WebSocketServer> | null = null;
  private logger: Logger;
  private metrics: PlaygroundMetrics;
  private authMiddleware: AuthMiddleware | null = null;
  private sessionStore: SessionStore;
  private startTime: number = 0;
  private draining: boolean = false;

  constructor(config: Partial<PlaygroundServerConfig> & { workspacePath: string; storagePath: string }) {
    this.config = { ...DEFAULT_SERVER_CONFIG, ...config };
    this.costConfig = DEFAULT_COST_CONFIG;
    this.sessionManager = new SessionManager(this.config);
    this.registry = getWorkspaceRegistry(this.config.storagePath);
    this.rateLimiter = createRateLimiter();
    this.contextManager = createContextManager(this.config.storagePath);
    this.logger = createLogger("PlaygroundServer");
    this.metrics = createPlaygroundMetrics();
    this.sessionStore = createSessionStore(this.config.storagePath, this.logger);
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
   * Start the playground server with Express HTTP and WebSocket
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error("Server is already running");
    }

    if (!express || !WebSocketServer) {
      throw new Error(
        "Playground server requires 'express' and 'ws' packages. " +
        "Install them with: npm install express ws"
      );
    }

    if (this.config.authEnabled && !this.authenticator) {
      this.authenticator = await createAuthenticator(this.config.storagePath);
    }

    // Initialize auth middleware if enabled
    if (this.config.authEnabled) {
      this.authMiddleware = createAuthMiddleware({
        supabaseUrl: process.env.SUPABASE_URL,
        supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      }, this.logger);
    }

    this.startTime = Date.now();
    const app = express();

    // CORS middleware
    if (this.config.cors) {
      app.use((req, res, next) => {
        const origin = req.headers.origin || "*";
        if (
          this.config.allowedOrigins.includes("*") ||
          this.config.allowedOrigins.includes(origin)
        ) {
          res.setHeader("Access-Control-Allow-Origin", origin);
          res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
          res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        }
        if (req.method === "OPTIONS") {
          return res.sendStatus(200);
        }
        next();
      });
    }

    app.use(express.json());

    // Health check
    app.get("/health", (_req, res) => {
      res.json({
        status: "ok",
        running: this.isRunning,
        clients: this.clients.size,
        uptime: process.uptime(),
      });
    });

    // Readiness probe
    app.get("/ready", (_req, res) => {
      const ready = this.isRunning && !this.draining;
      res.status(ready ? 200 : 503).json({
        ready,
        draining: this.draining,
        clients: this.clients.size,
      });
    });

    // Prometheus-compatible metrics endpoint
    app.get("/metrics", (_req, res) => {
      // Update runtime gauges
      this.metrics.uptimeSeconds.set((Date.now() - this.startTime) / 1000);
      this.metrics.wsConnectionsActive.set(this.clients.size);

      res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
      res.send(this.metrics.registry.serialize());
    });

    // Context health smoke test
    app.get("/context-health", (_req, res) => {
      try {
        // Round-trip: set → get → delete
        const entry = this.contextManager.set({
          key: "__health_check__",
          value: { ts: Date.now() },
          type: "object",
          sourceAgentId: "system",
          workspaceId: "__health__",
          ttl: 60,
        });
        const fetched = this.contextManager.get("__health_check__", "__health__");
        this.contextManager.delete(entry.id);

        res.json({
          status: fetched ? "ok" : "degraded",
          persistence: "sqlite",
          encryption: this.contextManager.isEncryptionEnabled(),
        });
      } catch (error) {
        res.status(500).json({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    });

    // Auth middleware for /api/* routes
    if (this.authMiddleware) {
      app.use("/api", this.authMiddleware.expressMiddleware);
    }

    // List available MCP tools
    app.get("/api/tools", (_req, res) => {
      res.json({
        tools: [
          // Indexing Tools
          {
            name: "nella_index",
            category: "indexing",
            description: "Index workspace for semantic and lexical search",
            inputSchema: {
              type: "object",
              properties: {
                force: { type: "boolean", description: "Force full reindex" },
                paths: { type: "array", items: { type: "string" }, description: "Specific paths to index" },
              },
            },
          },
          {
            name: "nella_search",
            category: "indexing",
            description: "Hybrid search (semantic + BM25) across indexed codebase",
            inputSchema: {
              type: "object",
              properties: {
                query: { type: "string", description: "Search query" },
                mode: { type: "string", enum: ["hybrid", "semantic", "lexical"], description: "Search mode" },
                topK: { type: "number", description: "Number of results" },
              },
              required: ["query"],
            },
          },
          // Context Tools
          {
            name: "nella_get_context",
            category: "context",
            description: "Get current session context (changes, assumptions, dependencies)",
            inputSchema: {
              type: "object",
              properties: {
                changesLimit: { type: "number", description: "Max recent changes to include" },
              },
            },
          },
          {
            name: "nella_add_assumption",
            category: "context",
            description: "Record an assumption about the codebase for later validation",
            inputSchema: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["schema", "interface", "dependency", "behavior", "config", "structure", "other"], description: "Type of assumption" },
                description: { type: "string", description: "Description of the assumption" },
                relatedFiles: { type: "array", items: { type: "string" }, description: "Related files" },
                confidence: { type: "number", description: "Confidence level 0-1" },
              },
              required: ["type", "description"],
            },
          },
          {
            name: "nella_check_assumptions",
            category: "context",
            description: "Get status of all tracked assumptions",
            inputSchema: {
              type: "object",
              properties: {},
            },
          },
          {
            name: "nella_check_dependencies",
            category: "context",
            description: "Check for dependency changes since session start",
            inputSchema: {
              type: "object",
              properties: {},
            },
          },
        ],
      });
    });

    // Get session state
    app.get("/api/session/:id", (req, res) => {
      const session = this.sessionManager.get(req.params.id);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      res.json({
        id: session.id,
        workspaceId: session.workspaceId,
        state: session.state,
        metadata: session.metadata,
        createdAt: session.createdAt,
        lastActivity: session.lastActivity,
        clientCount: session.clients.length,
      });
    });

    // Server status
    app.get("/api/status", (_req, res) => {
      res.json(this.getStatus());
    });

    // Workspace info
    app.get("/api/workspace", (_req, res) => {
      const workspace = this.workspaces.get(this.config.workspacePath);
      if (!workspace) {
        // Create workspace on the fly so the API always works
        const ws = Workspace.fromPath(this.config.workspacePath, undefined, { registry: this.registry });
        this.workspaces.set(this.config.workspacePath, ws);
        const info = ws.getInfo();
        return res.json({
          name: info.name,
          path: info.path,
          indexStatus: info.indexStatus,
          filesIndexed: info.stats.filesIndexed,
          chunksCount: info.stats.chunksCount,
        });
      }
      const info = workspace.getInfo();
      res.json({
        name: info.name,
        path: info.path,
        indexStatus: info.indexStatus,
        filesIndexed: info.stats.filesIndexed,
        chunksCount: info.stats.chunksCount,
      });
    });

    // Serve dashboard info at root - points to hosted dashboard
    app.get("/", (_req, res) => {
      const wsUrl = `ws://${this.config.host}:${this.config.port}/ws`;
      const dashboardUrl = `https://app.getnella.dev/dashboard/playground?ws=${encodeURIComponent(wsUrl)}`;
      
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Nella Playground Server</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              background: linear-gradient(135deg, #0d1117 0%, #161b22 100%);
              color: #c9d1d9;
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 20px;
            }
            .container {
              max-width: 600px;
              background: rgba(22, 27, 34, 0.8);
              border: 1px solid #30363d;
              border-radius: 12px;
              padding: 40px;
              text-align: center;
            }
            h1 { 
              color: #7c3aed;
              font-size: 2rem;
              margin-bottom: 8px;
            }
            .tagline {
              color: #8b949e;
              margin-bottom: 32px;
            }
            .status {
              background: #238636;
              color: white;
              padding: 8px 16px;
              border-radius: 20px;
              display: inline-block;
              font-size: 0.875rem;
              margin-bottom: 24px;
            }
            .endpoints {
              text-align: left;
              background: #0d1117;
              border-radius: 8px;
              padding: 20px;
              margin: 24px 0;
            }
            .endpoint {
              font-family: 'SF Mono', Monaco, monospace;
              font-size: 0.875rem;
              color: #58a6ff;
              margin: 8px 0;
            }
            .endpoint span { color: #8b949e; }
            .btn {
              display: inline-block;
              background: #7c3aed;
              color: white;
              padding: 12px 24px;
              border-radius: 8px;
              text-decoration: none;
              font-weight: 500;
              margin-top: 16px;
              transition: background 0.2s;
            }
            .btn:hover { background: #6d28d9; }
            .note {
              color: #8b949e;
              font-size: 0.875rem;
              margin-top: 24px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>⚡ Nella Playground</h1>
            <p class="tagline">Reliability layer for coding agents</p>
            <div class="status">● Server Running</div>
            
            <div class="endpoints">
              <div class="endpoint"><span>WebSocket:</span> ${wsUrl}</div>
              <div class="endpoint"><span>Health:</span> GET /health</div>
              <div class="endpoint"><span>Status:</span> GET /api/status</div>
              <div class="endpoint"><span>Session:</span> GET /api/session/:id</div>
            </div>
            
            <a href="${dashboardUrl}" class="btn" target="_blank">
              Open Dashboard →
            </a>
            
            <p class="note">
              Connect your MCP client to the WebSocket endpoint above,<br>
              or open the hosted dashboard to monitor sessions.
            </p>
          </div>
        </body>
        </html>
      `);
    });

    // Create HTTP or HTTPS server
    if (this.config.tls && this.config.tlsCert && this.config.tlsKey) {
      const tlsOptions = {
        cert: fs.readFileSync(this.config.tlsCert),
        key: fs.readFileSync(this.config.tlsKey),
      };
      this.httpServer = https.createServer(tlsOptions, app);
      this.logger.info("TLS enabled", { cert: this.config.tlsCert });
    } else {
      this.httpServer = http.createServer(app);
    }

    // Create WebSocket server
    this.wss = new WebSocketServer({ server: this.httpServer, path: "/ws" });

    this.wss.on("connection", async (ws, req) => {
      // Connection limit check
      const maxConn = this.config.maxConnections || 0;
      if (maxConn > 0 && this.clients.size >= maxConn) {
        this.logger.warn("Connection rejected: max connections reached", { max: maxConn });
        ws.close(1013, "Max connections reached");
        return;
      }

      // Reject during draining
      if (this.draining) {
        ws.close(1001, "Server is shutting down");
        return;
      }

      // WebSocket auth via ?token= query param
      if (this.authMiddleware) {
        const url = new URL(req.url || "/", `http://${req.headers.host}`);
        const token = url.searchParams.get("token");
        if (!token) {
          ws.close(4001, "Authentication required");
          return;
        }
        const authResult = await this.authMiddleware.validateToken(token);
        if (!authResult.valid) {
          ws.close(4003, authResult.error || "Invalid token");
          return;
        }
      }

      const correlationId = generateCorrelationId();
      const clientId = this.handleConnect((message: ServerMessage) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify(message));
        }
      });

      this.logger.info("Client connected", { clientId: clientId.slice(0, 16), correlationId });
      this.metrics.wsConnectionsActive.inc();

      ws.on("message", async (data) => {
        this.metrics.wsMessagesTotal.inc({ direction: "in" });
        try {
          const message = JSON.parse(data.toString()) as ClientMessage;
          this.metrics.wsMessagesTotal.inc({ direction: "in", type: message.type });
          await this.handleMessage(clientId, message);
        } catch (error) {
          this.metrics.errorsTotal.inc({ type: "ws_message_parse" });
          const client = this.clients.get(clientId);
          client?.send({
            type: "error",
            message: error instanceof Error ? error.message : "Invalid message",
          });
        }
      });

      ws.on("close", () => {
        this.logger.info("Client disconnected", { clientId: clientId.slice(0, 16) });
        this.metrics.wsConnectionsActive.dec();
        this.handleDisconnect(clientId);
      });

      ws.on("error", (error) => {
        this.logger.error("WebSocket error", { clientId: clientId.slice(0, 16), error: error.message });
        this.metrics.errorsTotal.inc({ type: "ws_error" });
        this.eventHandlers.onError?.(error);
        this.metrics.wsConnectionsActive.dec();
        this.handleDisconnect(clientId);
      });
    });

    // Start listening
    await new Promise<void>((resolve, reject) => {
      this.httpServer!.listen(this.config.port, this.config.host, () => {
        resolve();
      });
      this.httpServer!.on("error", reject);
    });

    this.isRunning = true;
    const proto = this.config.tls ? "https" : "http";
    const wsproto = this.config.tls ? "wss" : "ws";
    this.logger.info("Server started", {
      url: `${proto}://${this.config.host}:${this.config.port}`,
      ws: `${wsproto}://${this.config.host}:${this.config.port}/ws`,
      tls: !!this.config.tls,
      auth: this.config.authEnabled,
      maxConnections: this.config.maxConnections || "unlimited",
    });
    this.eventHandlers.onStart?.(this.config.port);
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    this.logger.info("Graceful shutdown initiated");
    this.draining = true;

    // Save active sessions to the store
    for (const client of this.clients.values()) {
      if (client.sessionId) {
        const session = this.sessionManager.get(client.sessionId);
        if (session) {
          this.sessionStore.save(session);
        }
      }
    }

    // Tell WS clients we're going away, give them 5s to finish
    if (this.wss) {
      for (const wsClient of this.wss.clients) {
        wsClient.close(1001, "Server shutting down");
      }
      // Wait up to 5s for clients to disconnect
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 5000);
        const check = setInterval(() => {
          if (this.clients.size === 0) {
            clearTimeout(timeout);
            clearInterval(check);
            resolve();
          }
        }, 100);
      });
      this.wss.close();
      this.wss = null;
    }

    // Close HTTP server
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
      this.httpServer = null;
    }

    // Disconnect all tracked clients
    for (const client of this.clients.values()) {
      this.handleDisconnect(client.id);
    }

    this.sessionManager.destroy();
    this.rateLimiter.destroy();
    this.contextManager.destroy();
    this.sessionStore.close();
    this.authMiddleware?.destroy();

    this.isRunning = false;
    this.draining = false;
    this.logger.info("Server stopped");
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
          await this.handleToolCall(client, message.toolName, message.arguments, message.callId);
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
    args: Record<string, unknown>,
    callId?: string
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
        authenticator: this.config.authEnabled ? (this.authenticator || undefined) : undefined,
        rateLimiter: this.rateLimiter,
        contextManager: this.contextManager,
      });
      this.toolHandlers.set(session.id, handler);
    }

    // Use client-provided callId or generate one
    const finalCallId = callId || `call_${crypto.randomBytes(8).toString("hex")}`;

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
      callId: finalCallId,
      toolName,
    });

    // Execute tool
    const startTime = Date.now();
    const result = await handler.handleToolCall({
      name: toolName,
      arguments: args,
    });
    const duration = Date.now() - startTime;
    const durationSec = duration / 1000;

    // Track metrics
    this.metrics.toolCallsTotal.inc({ tool: toolName, status: result.isError ? "error" : "success" });
    this.metrics.toolDurationSeconds.observe(durationSec, { tool: toolName });

    // Estimate tokens and cost
    const tokens = this.estimateTokens(args, result);
    const cost = this.estimateCost(tokens);

    this.metrics.tokensTotal.inc({ tool: toolName }, tokens);
    this.metrics.costTotal.inc({ tool: toolName }, cost);

    // Create entry
    const entry: ToolCallEntry = {
      id: finalCallId,
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
      callId: finalCallId,
      entry,
    });

    // Check rate limits
    const usage = this.rateLimiter.getUsage(workspace.id);
    if (usage) {
      this.sessionManager.updateState(session.id, {
        rateLimitStatus: {
          minute: { used: usage.minute.count, limit: usage.minute.limit },
          hour: { used: usage.hour.count, limit: usage.hour.limit },
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
      const indexStart = Date.now();
      await workspace.index({ incremental });

      const indexDuration = (Date.now() - indexStart) / 1000;
      this.metrics.indexingDurationSeconds.observe(indexDuration);

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
    if (!client.sessionId) {
      throw new Error("Not subscribed to a session");
    }

    const session = this.sessionManager.get(client.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    try {
      if (key) {
        // Get a specific context entry
        const entry = this.contextManager.get(key, session.workspaceId);
        client.send({
          type: "context:data",
          key,
          value: entry ? entry.value : null,
        });
      } else {
        // List all entries for the workspace via wildcard query
        const result = this.contextManager.query(session.workspaceId, { keyPattern: "*" });
        for (const entry of result.entries) {
          client.send({
            type: "context:data",
            key: entry.key,
            value: entry.value,
          });
        }
      }
    } catch (error) {
      this.logger.error("Context get failed", { key, error: String(error) });
      client.send({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
        code: "CONTEXT_GET_ERROR",
      });
    }
  }

  private async handleContextSet(client: WebSocketClient, key: string, value: unknown): Promise<void> {
    if (!client.sessionId) {
      throw new Error("Not subscribed to a session");
    }

    const session = this.sessionManager.get(client.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    try {
      this.contextManager.set({
        key,
        value,
        type: typeof value === "object" ? "object" : "string",
        sourceAgentId: client.id,
        workspaceId: session.workspaceId,
      });

      client.send({
        type: "context:updated",
        key,
        success: true,
      });

      // Broadcast to other clients in the session
      const others = session.clients.filter((id) => id !== client.id);
      for (const otherId of others) {
        const other = this.clients.get(otherId);
        other?.send({
          type: "context:data",
          key,
          value,
        });
      }
    } catch (error) {
      this.logger.error("Context set failed", { key, error: String(error) });
      client.send({
        type: "context:updated",
        key,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // =============================================================================
  // =============================================================================
  // Helpers
  // =============================================================================

  private broadcast(sessionId: string, message: ServerMessage): void {
    const session = this.sessionManager.get(sessionId);
    if (!session) return;

    for (const clientId of session.clients) {
      const client = this.clients.get(clientId);
      if (client) {
        client.send(message);
        this.metrics.wsMessagesTotal.inc({ direction: "out", type: message.type });
      }
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
