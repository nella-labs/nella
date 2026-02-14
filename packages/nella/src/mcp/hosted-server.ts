/**
 * Hosted MCP Server
 *
 * Exposes Nella's MCP tools over Streamable HTTP transport.
 * Authenticates via API keys stored in Supabase, rate limits via Redis,
 * and logs usage to the usage_events table.
 *
 * Usage:
 *   nella serve --port 3000
 *   NODE_ENV=production node packages/nella/dist/mcp/hosted-server.js
 *
 * Required env vars:
 *   SUPABASE_URL              - Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY - Supabase service role key
 *   REDIS_URL                 - Redis connection string (rediss://... for TLS)
 *
 * Optional env vars:
 *   PORT                      - HTTP port (default: 3000)
 *   NELLA_LOG_LEVEL           - Log level (default: info)
 */

import * as crypto from "crypto";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import dotenv from "dotenv";

// Load .env from repo root (two levels up from packages/nella/)
dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });
// Also try cwd for Docker / production
dotenv.config();

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { ContextManager } from "@usenella/core";
import { WebSocketServer, WebSocket } from "ws";
import Redis from "ioredis";
import { registerValidationTools, handleValidationTool } from "./tools/validation";
import { registerSafetyTools, handleSafetyTool } from "./tools/safety";
import { registerContextTools, handleContextTool } from "./tools/context";
import { registerCodeTools, handleCodeTool } from "./tools/code";
import type { ServerContext } from "./server";

// =============================================================================
// Types
// =============================================================================

interface ApiKeyRecord {
  id: string;
  user_id: string;
  name: string;
  key_prefix: string;
  rate_limits: {
    requests_per_minute: number;
    requests_per_hour: number;
    requests_per_day: number;
  } | null;
  expires_at: string | null;
  revoked_at: string | null;
}

interface AuthenticatedRequest {
  apiKeyId: string;
  userId: string;
  rateLimits: {
    requests_per_minute: number;
    requests_per_hour: number;
    requests_per_day: number;
  };
}

interface RateLimitEntry {
  timestamps: number[];
}

export interface HostedServerOptions {
  port?: number;
  host?: string;
}

// =============================================================================
// Supabase Client (lazy)
// =============================================================================

let supabaseClient: any = null;

function getSupabase() {
  if (supabaseClient) return supabaseClient;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables"
    );
  }

  try {
    const { createClient } = require("@supabase/supabase-js");
    supabaseClient = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    return supabaseClient;
  } catch {
    throw new Error(
      "Failed to initialize Supabase client. Ensure @supabase/supabase-js is installed."
    );
  }
}

// =============================================================================
// Rate Limiter (Redis when available, in-memory fallback)
// =============================================================================

let redisClient: Redis | null = null;

function initRedis(): void {
  const redisUrl =
    process.env.REDIS_URL ||
    process.env.REDIS_PRIVATE_URL ||
    process.env.REDIS_PUBLIC_URL;
  if (!redisUrl) {
    console.log("[rate-limit] No REDIS_URL set — using in-memory rate limiting");
    return;
  }

  try {
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times: number) {
        if (times > 5) return null; // stop retrying after 5 attempts
        return Math.min(times * 200, 2000);
      },
      enableReadyCheck: true,
      lazyConnect: false,
    });

    redisClient.on("connect", () => {
      console.log("[rate-limit] Connected to Redis");
    });

    redisClient.on("error", (err: Error) => {
      console.error("[rate-limit] Redis error:", err.message);
    });

    redisClient.on("close", () => {
      console.log("[rate-limit] Redis connection closed");
    });
  } catch (err) {
    console.error(
      "[rate-limit] Failed to create Redis client:",
      err instanceof Error ? err.message : err
    );
    redisClient = null;
  }
}

// In-memory fallback store
const rateLimitStore = new Map<string, RateLimitEntry>();

async function checkRateLimitRedis(
  apiKeyId: string,
  limits: AuthenticatedRequest["rateLimits"]
): Promise<{ allowed: boolean; retryAfter?: number; reason?: string }> {
  if (!redisClient) return checkRateLimitMemory(apiKeyId, limits);

  const key = `ratelimit:${apiKeyId}`;
  const now = Date.now();

  try {
    // Use a pipeline for atomicity and performance
    const pipe = redisClient.pipeline();
    // Remove entries older than 24h
    pipe.zremrangebyscore(key, 0, now - 86400000);
    // Count entries in each window
    pipe.zcount(key, now - 60000, "+inf"); // per-minute
    pipe.zcount(key, now - 3600000, "+inf"); // per-hour
    pipe.zcount(key, now - 86400000, "+inf"); // per-day

    const results = await pipe.exec();
    if (!results) return checkRateLimitMemory(apiKeyId, limits);

    const perMinute = (results[1]?.[1] as number) || 0;
    const perHour = (results[2]?.[1] as number) || 0;
    const perDay = (results[3]?.[1] as number) || 0;

    if (perMinute >= limits.requests_per_minute) {
      return {
        allowed: false,
        retryAfter: 60,
        reason: `Rate limit exceeded: ${perMinute}/${limits.requests_per_minute} requests per minute`,
      };
    }
    if (perHour >= limits.requests_per_hour) {
      return {
        allowed: false,
        retryAfter: 3600,
        reason: `Rate limit exceeded: ${perHour}/${limits.requests_per_hour} requests per hour`,
      };
    }
    if (perDay >= limits.requests_per_day) {
      return {
        allowed: false,
        retryAfter: 86400,
        reason: `Rate limit exceeded: ${perDay}/${limits.requests_per_day} requests per day`,
      };
    }

    // Record this request — use timestamp as both score and unique member
    const uniqueMember = `${now}:${Math.random().toString(36).slice(2, 8)}`;
    await redisClient
      .pipeline()
      .zadd(key, now, uniqueMember)
      .expire(key, 86400) // TTL 24h
      .exec();

    return { allowed: true };
  } catch (err) {
    console.error(
      "[rate-limit] Redis check failed, falling back to memory:",
      err instanceof Error ? err.message : err
    );
    return checkRateLimitMemory(apiKeyId, limits);
  }
}

function checkRateLimitMemory(
  apiKeyId: string,
  limits: AuthenticatedRequest["rateLimits"]
): { allowed: boolean; retryAfter?: number; reason?: string } {
  const now = Date.now();
  const entry = rateLimitStore.get(apiKeyId) || { timestamps: [] };

  // Clean old entries (older than 24h)
  const dayAgo = now - 86400000;
  entry.timestamps = entry.timestamps.filter((t) => t > dayAgo);

  const minuteAgo = now - 60000;
  const hourAgo = now - 3600000;

  const perMinute = entry.timestamps.filter((t) => t > minuteAgo).length;
  const perHour = entry.timestamps.filter((t) => t > hourAgo).length;
  const perDay = entry.timestamps.length;

  if (perMinute >= limits.requests_per_minute) {
    return {
      allowed: false,
      retryAfter: 60,
      reason: `Rate limit exceeded: ${perMinute}/${limits.requests_per_minute} requests per minute`,
    };
  }
  if (perHour >= limits.requests_per_hour) {
    return {
      allowed: false,
      retryAfter: 3600,
      reason: `Rate limit exceeded: ${perHour}/${limits.requests_per_hour} requests per hour`,
    };
  }
  if (perDay >= limits.requests_per_day) {
    return {
      allowed: false,
      retryAfter: 86400,
      reason: `Rate limit exceeded: ${perDay}/${limits.requests_per_day} requests per day`,
    };
  }

  entry.timestamps.push(now);
  rateLimitStore.set(apiKeyId, entry);
  return { allowed: true };
}

// Unified entry point — async to support Redis
async function checkRateLimit(
  apiKeyId: string,
  limits: AuthenticatedRequest["rateLimits"]
): Promise<{ allowed: boolean; retryAfter?: number; reason?: string }> {
  return redisClient
    ? checkRateLimitRedis(apiKeyId, limits)
    : checkRateLimitMemory(apiKeyId, limits);
}

// =============================================================================
// Auth: API Key Validation
// =============================================================================

// Cache validated keys for 60s to avoid hammering Supabase
const keyCache = new Map<string, { record: ApiKeyRecord; cachedAt: number }>();
const KEY_CACHE_TTL = 60000;

async function validateApiKey(
  apiKey: string
): Promise<{ success: true; record: ApiKeyRecord } | { success: false; error: string; status: number }> {
  if (!apiKey || !apiKey.startsWith("nella_")) {
    return { success: false, error: "Invalid API key format", status: 401 };
  }

  const keyHash = crypto.createHash("sha256").update(apiKey).digest("hex");

  // Check cache
  const cached = keyCache.get(keyHash);
  if (cached && Date.now() - cached.cachedAt < KEY_CACHE_TTL) {
    return { success: true, record: cached.record };
  }

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("api_keys")
      .select("id, user_id, name, key_prefix, rate_limits, expires_at, revoked_at")
      .eq("key_hash", keyHash)
      .single();

    if (error || !data) {
      return { success: false, error: "Invalid API key", status: 401 };
    }

    const record = data as ApiKeyRecord;

    if (record.revoked_at) {
      return { success: false, error: "API key has been revoked", status: 403 };
    }

    if (record.expires_at && new Date(record.expires_at) < new Date()) {
      return { success: false, error: "API key has expired", status: 403 };
    }

    // Cache it
    keyCache.set(keyHash, { record, cachedAt: Date.now() });

    // Update last_used_at (fire and forget)
    supabase
      .from("api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", record.id)
      .then(() => {})
      .catch(() => {});

    return { success: true, record };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Auth error: ${message}`, status: 500 };
  }
}

// =============================================================================
// Usage Logging
// =============================================================================

async function logUsageEvent(params: {
  apiKeyId: string;
  toolName: string;
  durationMs: number;
  success: boolean;
  error?: string;
  workspace?: string;
  tokensUsed?: number;
}): Promise<void> {
  try {
    const supabase = getSupabase();
    // Table columns: id, api_key_id, tool_name, tokens_used, workspace, created_at
    // (no duration_ms, success, or error columns)
    const { error } = await supabase.from("usage_events").insert({
      api_key_id: params.apiKeyId,
      tool_name: params.toolName,
      tokens_used: params.tokensUsed || 0,
      workspace: params.workspace || null,
    });
    if (error) {
      log("error", "Failed to log usage event to Supabase", {
        supabaseError: error.message,
        code: error.code,
        toolName: params.toolName,
        apiKeyId: params.apiKeyId,
      });
    } else {
      log("info", "Usage event logged", {
        toolName: params.toolName,
        durationMs: params.durationMs,
        success: params.success,
      });
    }
  } catch (err) {
    log("error", "Usage logging threw exception", {
      error: err instanceof Error ? err.message : String(err),
      toolName: params.toolName,
    });
  }
}

// =============================================================================
// Playground Types & Session Management
// =============================================================================

interface PlaygroundSessionState {
  activeAgent: string | null;
  chainOfThought: PlaygroundCotEntry[];
  recentToolCalls: PlaygroundToolCall[];
  recentSearches: PlaygroundSearchEntry[];
  indexStatus: "none" | "indexing" | "ready" | "error";
  rateLimitStatus: {
    minute: { used: number; limit: number };
    hour: { used: number; limit: number };
  };
}

interface PlaygroundCotEntry {
  id: string;
  type: "thought" | "action" | "observation" | "result";
  content: string;
  timestamp: string;
  duration?: number;
}

interface PlaygroundToolCall {
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  success: boolean;
  error?: string;
  duration: number;
  timestamp: string;
  tokens?: number;
  cost?: number;
}

interface PlaygroundSearchEntry {
  id: string;
  query: string;
  resultsCount: number;
  confidence: number;
  duration: number;
  timestamp: string;
}

interface PlaygroundClient {
  id: string;
  ws: WebSocket;
  sessionId: string | null;
  apiKeyId: string;
  userId: string;
  rateLimits: { requests_per_minute: number; requests_per_hour: number; requests_per_day: number };
}

interface PlaygroundSession {
  id: string;
  userId: string;
  state: PlaygroundSessionState;
  clients: Set<string>;
  lastActivity: number;
}

const DEFAULT_COST_CONFIG = {
  inputCostPer1k: 0.01,
  outputCostPer1k: 0.03,
};

function createEmptySessionState(): PlaygroundSessionState {
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

// =============================================================================
// Server
// =============================================================================

const startTime = Date.now();

function log(level: string, message: string, data?: Record<string, unknown>): void {
  const logLevel = process.env.NELLA_LOG_LEVEL || "info";
  const levels = ["debug", "info", "warn", "error"];
  if (levels.indexOf(level) < levels.indexOf(logLevel)) return;

  const timestamp = new Date().toISOString();
  const entry = { timestamp, level, message, ...data };
  console.log(JSON.stringify(entry));
}

export async function startHostedServer(options: HostedServerOptions = {}): Promise<void> {
  const port = options.port || parseInt(process.env.PORT || "3000", 10);
  const host = options.host || "0.0.0.0";

  // Validate required env vars early
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
    process.exit(1);
  }

  // Initialize Redis (if REDIS_URL is set)
  initRedis();

  // Collect all tools
  const allTools: Tool[] = [
    ...registerValidationTools(),
    ...registerSafetyTools(),
    ...registerContextTools(),
    ...registerCodeTools(),
  ];

  log("info", "Nella hosted MCP server starting", { port, tools: allTools.length });

  // Track active transports per session
  const transports = new Map<string, StreamableHTTPServerTransport>();

  // Create a new MCP server + transport for a session
  async function createSession(ownerUserId?: string, ownerApiKeyId?: string): Promise<{ server: Server; transport: StreamableHTTPServerTransport }> {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });

    const server = new Server(
      { name: "nella", version: "0.2.2" },
      { capabilities: { tools: {} } }
    );

    // List tools
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: allTools };
    });

    // Handle tool calls
    server.setRequestHandler(
      CallToolRequestSchema,
      async (request: {
        params: { name: string; arguments?: Record<string, unknown> };
      }): Promise<CallToolResult> => {
        const { name, arguments: toolArgs } = request.params;
        const callStart = Date.now();
        const callId = `mcp-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;

        // Broadcast tool:start to playground
        log("info", "MCP tool call started", { toolName: name, callId, ownerUserId: ownerUserId || "none" });
        if (ownerUserId) {
          const startPayload = {
            type: "tool:start",
            callId,
            toolName: name,
          };

          if (redisClient) {
            // Publish to Redis — the subscriber (even on same instance) delivers to clients
            redisClient.publish(`nella:tool-events:${ownerUserId}`, JSON.stringify(startPayload)).catch((err) => {
              log("error", "Redis publish tool:start failed", { error: err instanceof Error ? err.message : String(err) });
            });
          } else {
            // No Redis — fallback to in-memory broadcast
            broadcastToUserPlayground(ownerUserId, startPayload);
          }
        }

        // Create a temporary workspace context for this call
        const tmpDir = path.join(
          os.tmpdir(),
          `nella-hosted-${crypto.randomBytes(4).toString("hex")}`
        );

        let success = false;
        let resultContent: CallToolResult | null = null;
        let errorMessage: string | undefined;

        try {
          // Ensure temp dir exists
          if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
          }

          const contextManager = new ContextManager(tmpDir);
          const serverContext: ServerContext = {
            workspacePath: tmpDir,
            contextManager,
          };

          // Try each tool category
          const validationResult = await handleValidationTool(
            name,
            toolArgs || {},
            serverContext
          );
          if (validationResult !== null) {
            resultContent = validationResult as CallToolResult;
            success = !resultContent.isError;
          }

          if (resultContent === null) {
            const safetyResult = await handleSafetyTool(
              name,
              toolArgs || {},
              serverContext
            );
            if (safetyResult !== null) {
              resultContent = safetyResult as CallToolResult;
              success = !resultContent.isError;
            }
          }

          if (resultContent === null) {
            const contextResult = await handleContextTool(
              name,
              toolArgs || {},
              serverContext
            );
            if (contextResult !== null) {
              resultContent = contextResult as CallToolResult;
              success = !resultContent.isError;
            }
          }

          if (resultContent === null) {
            const codeResult = await handleCodeTool(
              name,
              toolArgs || {},
              serverContext
            );
            if (codeResult !== null) {
              resultContent = codeResult as CallToolResult;
              success = !resultContent.isError;
            }
          }

          if (resultContent === null) {
            errorMessage = `Unknown tool: ${name}`;
            resultContent = {
              content: [{ type: "text", text: errorMessage }],
              isError: true,
            } as CallToolResult;
          }

          return resultContent;
        } catch (error) {
          errorMessage = error instanceof Error ? error.message : String(error);
          success = false;
          resultContent = {
            content: [
              { type: "text", text: `Error executing ${name}: ${errorMessage}` },
            ],
            isError: true,
          } as CallToolResult;
          return resultContent;
        } finally {
          // Clean up temp dir
          try {
            if (fs.existsSync(tmpDir)) {
              fs.rmSync(tmpDir, { recursive: true, force: true });
            }
          } catch {
            // Best effort cleanup
          }

          const duration = Date.now() - callStart;

          // Extract result text for token estimation
          const resultText = resultContent
            ? resultContent.content.map((c: any) => c.text || "").join("")
            : "";
          const argsText = JSON.stringify(toolArgs || {});
          const inputTokens = Math.ceil(argsText.length / 4);
          const outputTokens = Math.ceil(resultText.length / 4);
          const cost = (inputTokens / 1000) * DEFAULT_COST_CONFIG.inputCostPer1k +
                       (outputTokens / 1000) * DEFAULT_COST_CONFIG.outputCostPer1k;

          // Build tool call entry for playground
          const toolCallEntry: PlaygroundToolCall = {
            id: callId,
            toolName: name,
            arguments: toolArgs || {},
            result: resultContent,
            success,
            error: errorMessage,
            duration,
            timestamp: new Date().toISOString(),
            tokens: inputTokens + outputTokens,
            cost,
          };

          // Broadcast tool:end to playground
          if (ownerUserId) {
            const endPayload = {
              type: "tool:end",
              callId,
              entry: toolCallEntry,
            };

            if (redisClient) {
              // Publish to Redis — subscriber handles delivery + session recording
              try {
                await redisClient.publish(`nella:tool-events:${ownerUserId}`, JSON.stringify(endPayload));
              } catch {
                // Best effort — Redis pubsub failure shouldn't block
              }
            } else {
              // No Redis — fallback to in-memory
              recordToolCallInPlayground(ownerUserId, toolCallEntry);
              broadcastToUserPlayground(ownerUserId, endPayload);
            }
          }

          // Log usage to Supabase
          if (ownerApiKeyId) {
            await logUsageEvent({
              apiKeyId: ownerApiKeyId,
              toolName: name,
              durationMs: duration,
              success,
              error: errorMessage,
              tokensUsed: inputTokens + outputTokens,
            });
          }
        }
      }
    );

    // Track transport lifecycle
    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) transports.delete(sid);
      server.close().catch(() => {});
    };

    await server.connect(transport).catch((err) => {
      log("error", "Failed to connect MCP server to transport", {
        error: String(err),
      });
    });

    // NOTE: transport.sessionId is NOT set until handleRequest processes
    // the "initialize" message, so we must NOT register it here.
    // Registration happens in the POST handler after handleRequest().

    return { server, transport };
  }

  // =========================================================================
  // HTTP Server
  // =========================================================================

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type, Mcp-Session-Id"
    );
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // -----------------------------------------------------------------------
    // GET /health
    // -----------------------------------------------------------------------
    if (pathname === "/health" && req.method === "GET") {
      const health = {
        status: "ok",
        version: "0.2.2",
        uptime: Math.floor((Date.now() - startTime) / 1000),
        activeSessions: transports.size,
        redis: redisClient ? redisClient.status : "disabled",
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(health));
      return;
    }

    // -----------------------------------------------------------------------
    // GET /api/tools — tool definitions for Playground UI
    // -----------------------------------------------------------------------
    if (pathname === "/api/tools" && req.method === "GET") {
      const toolsWithCategory = allTools.map((tool) => {
        let category = "context";
        if (tool.name.startsWith("nella_check") || tool.name.startsWith("nella_validate") || tool.name.startsWith("nella_run")) {
          category = "validation";
        } else if (tool.name.startsWith("nella_safety") || tool.name.startsWith("nella_should_refuse") || tool.name.startsWith("nella_guardrails")) {
          category = "safety";
        }
        return {
          name: tool.name,
          category,
          description: tool.description || "",
          inputSchema: tool.inputSchema,
        };
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ tools: toolsWithCategory }));
      return;
    }

    // -----------------------------------------------------------------------
    // MCP endpoint: POST/GET/DELETE /mcp
    // -----------------------------------------------------------------------
    if (pathname === "/mcp") {
      // Authenticate
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing Authorization: Bearer <api_key> header" }));
        return;
      }

      const apiKey = authHeader.slice(7);
      const authResult = await validateApiKey(apiKey);
      if (!authResult.success) {
        res.writeHead(authResult.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: authResult.error }));
        return;
      }

      const keyRecord = authResult.record;
      const rateLimits = keyRecord.rate_limits || {
        requests_per_minute: 20,
        requests_per_hour: 100,
        requests_per_day: 500,
      };

      // Rate limit check (only for POST = actual tool calls / messages)
      if (req.method === "POST") {
        const rl = await checkRateLimit(keyRecord.id, rateLimits);
        if (!rl.allowed) {
          res.writeHead(429, {
            "Content-Type": "application/json",
            "Retry-After": String(rl.retryAfter || 60),
          });
          res.end(JSON.stringify({ error: rl.reason }));
          return;
        }
      }

      // Route to transport
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (req.method === "POST") {
        // Read body
        const body = await new Promise<string>((resolve, reject) => {
          let data = "";
          req.on("data", (chunk: Buffer) => (data += chunk.toString()));
          req.on("end", () => resolve(data));
          req.on("error", reject);
        });

        let parsedBody: unknown;
        try {
          parsedBody = JSON.parse(body);
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }

        // Check if this is an initialization request (method: "initialize")
        const isInit =
          Array.isArray(parsedBody)
            ? parsedBody.some((m: any) => m.method === "initialize")
            : (parsedBody as any)?.method === "initialize";

        if (isInit || !sessionId) {
          // New session — pass user info for playground bridging & usage logging
          const { transport } = await createSession(keyRecord.user_id, keyRecord.id);

          await transport.handleRequest(req, res, parsedBody);

          // Register session AFTER handleRequest assigns the session ID
          if (transport.sessionId && !transports.has(transport.sessionId)) {
            transports.set(transport.sessionId, transport);
            log("info", "New MCP session registered", { sessionId: transport.sessionId });
          }
        } else {
          // Existing session
          const transport = transports.get(sessionId);
          if (!transport) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Session not found" }));
            return;
          }
          await transport.handleRequest(req, res, parsedBody);
        }

        return;
      }

      if (req.method === "GET") {
        // SSE stream for server-to-client notifications
        if (!sessionId) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing Mcp-Session-Id header" }));
          return;
        }
        const transport = transports.get(sessionId);
        if (!transport) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Session not found" }));
          return;
        }
        await transport.handleRequest(req, res);
        return;
      }

      if (req.method === "DELETE") {
        // Session termination
        if (sessionId) {
          const transport = transports.get(sessionId);
          if (transport) {
            await transport.close();
            transports.delete(sessionId);
          }
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "session terminated" }));
        return;
      }
    }

    // -----------------------------------------------------------------------
    // 404 fallback
    // -----------------------------------------------------------------------
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  // =========================================================================
  // WebSocket Playground Server
  // =========================================================================

  const playgroundSessions = new Map<string, PlaygroundSession>();
  const playgroundClients = new Map<string, PlaygroundClient>();

  // -------------------------------------------------------------------------
  // Redis pub/sub for cross-instance playground bridging
  // When a tool call happens on instance A, it publishes to Redis.
  // Instance B (which has the WebSocket) subscribes and forwards to clients.
  // -------------------------------------------------------------------------
  let redisSub: Redis | null = null;
  // Track which user IDs we're subscribed to
  const subscribedUsers = new Set<string>();

  function setupRedisSubscriber(): void {
    const redisUrl =
      process.env.REDIS_URL ||
      process.env.REDIS_PRIVATE_URL ||
      process.env.REDIS_PUBLIC_URL;
    if (!redisUrl) return;

    try {
      // Need a separate connection for subscribing (Redis constraint)
      redisSub = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy(times: number) {
          if (times > 5) return null;
          return Math.min(times * 200, 2000);
        },
        enableReadyCheck: true,
        lazyConnect: false,
      });

      redisSub.on("message", (channel: string, message: string) => {
        try {
          // Channel format: nella:tool-events:<userId>
          const userId = channel.replace("nella:tool-events:", "");
          const parsed = JSON.parse(message);

          log("info", "Redis sub received tool event", { userId, type: parsed.type });

          // Forward to all playground sessions for this user
          for (const [_key, session] of playgroundSessions) {
            if (session.userId === userId) {
              // Also record in session state if it's a tool:end event
              if (parsed.type === "tool:end" && parsed.entry) {
                session.state.recentToolCalls = [
                  ...session.state.recentToolCalls.slice(-49),
                  parsed.entry,
                ];
                session.lastActivity = Date.now();
              }

              for (const cid of session.clients) {
                const c = playgroundClients.get(cid);
                if (c) sendToClient(c.ws, parsed);
              }
            }
          }
        } catch (err) {
          log("error", "Redis sub message handling error", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });

      redisSub.on("connect", () => {
        log("info", "Redis subscriber connected for playground bridging");
      });

      redisSub.on("error", (err: Error) => {
        log("error", "Redis subscriber error", { error: err.message });
      });
    } catch (err) {
      log("error", "Failed to create Redis subscriber", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Subscribe to a user's tool events channel
  function subscribeToUserEvents(userId: string): void {
    if (!redisSub || subscribedUsers.has(userId)) return;
    const channel = `nella:tool-events:${userId}`;
    redisSub.subscribe(channel).then(() => {
      subscribedUsers.add(userId);
      log("info", "Subscribed to Redis channel", { channel });
    }).catch((err) => {
      log("error", "Failed to subscribe to Redis channel", {
        channel,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  // Unsubscribe when no more playground clients for a user
  function unsubscribeFromUserEvents(userId: string): void {
    if (!redisSub || !subscribedUsers.has(userId)) return;
    // Check if any sessions still have clients for this user
    for (const [_key, session] of playgroundSessions) {
      if (session.userId === userId && session.clients.size > 0) return;
    }
    const channel = `nella:tool-events:${userId}`;
    redisSub.unsubscribe(channel).then(() => {
      subscribedUsers.delete(userId);
      log("info", "Unsubscribed from Redis channel", { channel });
    }).catch(() => {});
  }

  setupRedisSubscriber();

  // Cleanup stale sessions every 60s
  const playgroundCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of playgroundSessions) {
      if (session.clients.size === 0 && now - session.lastActivity > 30 * 60 * 1000) {
        playgroundSessions.delete(id);
        log("debug", "Cleaned up stale playground session", { sessionId: id });
      }
    }
  }, 60000);

  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", async (ws, req) => {
    // Authenticate via ?token= query parameter
    const reqUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const token = reqUrl.searchParams.get("token");

    if (!token) {
      ws.close(4001, "Missing ?token= parameter");
      return;
    }

    const authResult = await validateApiKey(token);
    if (!authResult.success) {
      ws.close(4001, authResult.error);
      return;
    }

    const keyRecord = authResult.record;
    const rateLimits = keyRecord.rate_limits || {
      requests_per_minute: 20,
      requests_per_hour: 100,
      requests_per_day: 500,
    };

    const clientId = crypto.randomUUID();
    const client: PlaygroundClient = {
      id: clientId,
      ws,
      sessionId: null,
      apiKeyId: keyRecord.id,
      userId: keyRecord.user_id,
      rateLimits,
    };
    playgroundClients.set(clientId, client);

    log("info", "Playground client connected", { clientId, userId: keyRecord.user_id });

    ws.on("message", async (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        await handlePlaygroundMessage(client, message);
      } catch (err) {
        sendToClient(ws, { type: "error", message: "Invalid message format" });
      }
    });

    ws.on("close", () => {
      if (client.sessionId) {
        const session = playgroundSessions.get(client.sessionId);
        if (session) {
          session.clients.delete(clientId);
        }
      }
      playgroundClients.delete(clientId);
      log("info", "Playground client disconnected", { clientId });

      // Unsubscribe from Redis if no more clients for this user
      unsubscribeFromUserEvents(client.userId);
    });

    ws.on("error", (err) => {
      log("error", "Playground WebSocket error", { clientId, error: String(err) });
    });
  });

  function sendToClient(ws: WebSocket, message: unknown): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  function broadcastToSession(sessionId: string, message: unknown): void {
    const session = playgroundSessions.get(sessionId);
    if (!session) return;
    for (const cid of session.clients) {
      const c = playgroundClients.get(cid);
      if (c) sendToClient(c.ws, message);
    }
  }

  // Helper: find all playground sessions belonging to a user and broadcast
  function broadcastToUserPlayground(userId: string, message: unknown): void {
    log("info", "broadcastToUserPlayground called", {
      userId,
      totalSessions: playgroundSessions.size,
      totalClients: playgroundClients.size,
      sessionKeys: Array.from(playgroundSessions.keys()),
      sessionUserIds: Array.from(playgroundSessions.values()).map(s => s.userId),
    });
    let matched = 0;
    for (const [_key, session] of playgroundSessions) {
      if (session.userId === userId) {
        matched++;
        for (const cid of session.clients) {
          const c = playgroundClients.get(cid);
          if (c) {
            log("info", "Sending to playground client", { clientId: cid });
            sendToClient(c.ws, message);
          }
        }
      }
    }
    if (matched === 0) {
      log("info", "No playground sessions found for user", { userId });
    }
  }

  // Helper: update playground session state for a user with a tool call entry
  function recordToolCallInPlayground(userId: string, entry: PlaygroundToolCall): void {
    for (const [_key, session] of playgroundSessions) {
      if (session.userId === userId) {
        session.state.recentToolCalls = [...session.state.recentToolCalls.slice(-49), entry];
        session.lastActivity = Date.now();
      }
    }
  }

  async function handlePlaygroundMessage(client: PlaygroundClient, message: any): Promise<void> {
    switch (message.type) {
      case "subscribe": {
        const sessionKey = `${client.userId}:${message.sessionId || "default"}`;
        let session = playgroundSessions.get(sessionKey);
        if (!session) {
          session = {
            id: sessionKey,
            userId: client.userId,
            state: createEmptySessionState(),
            clients: new Set(),
            lastActivity: Date.now(),
          };
          // Set rate limit info from the client's key
          session.state.rateLimitStatus = {
            minute: { used: 0, limit: client.rateLimits.requests_per_minute },
            hour: { used: 0, limit: client.rateLimits.requests_per_hour },
          };
          playgroundSessions.set(sessionKey, session);
        }
        client.sessionId = sessionKey;
        session.clients.add(client.id);
        session.lastActivity = Date.now();

        sendToClient(client.ws, { type: "connected", sessionId: sessionKey, clientId: client.id });
        sendToClient(client.ws, { type: "session:state", state: session.state });

        // Subscribe to Redis channel for cross-instance tool event bridging
        subscribeToUserEvents(client.userId);
        break;
      }

      case "unsubscribe": {
        if (client.sessionId) {
          const session = playgroundSessions.get(client.sessionId);
          if (session) session.clients.delete(client.id);
          client.sessionId = null;
        }
        break;
      }

      case "tool:call": {
        if (!client.sessionId) {
          sendToClient(client.ws, { type: "error", message: "Not subscribed to a session" });
          return;
        }
        const session = playgroundSessions.get(client.sessionId);
        if (!session) return;

        // Rate limit check
        const rl = await checkRateLimit(client.apiKeyId, client.rateLimits);
        if (!rl.allowed) {
          sendToClient(client.ws, { type: "error", message: rl.reason || "Rate limit exceeded" });
          return;
        }

        const { toolName, arguments: toolArgs, callId } = message;
        const resolvedCallId = callId || `pg-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
        const callStart = Date.now();

        // Broadcast tool:start
        broadcastToSession(client.sessionId, {
          type: "tool:start",
          callId: resolvedCallId,
          toolName,
        });

        // Add CoT action entry
        const actionEntry: PlaygroundCotEntry = {
          id: `cot-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
          type: "action",
          content: `Calling tool: ${toolName}`,
          timestamp: new Date().toISOString(),
        };
        session.state.chainOfThought = [...session.state.chainOfThought.slice(-99), actionEntry];
        broadcastToSession(client.sessionId, { type: "cot:entry", entry: actionEntry });

        // Execute tool
        const tmpDir = path.join(os.tmpdir(), `nella-pg-${crypto.randomBytes(4).toString("hex")}`);
        let success = false;
        let result: unknown = null;
        let error: string | undefined;

        try {
          if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

          const contextManager = new ContextManager(tmpDir);
          const serverContext: ServerContext = { workspacePath: tmpDir, contextManager };

          const validationResult = await handleValidationTool(toolName, toolArgs || {}, serverContext);
          if (validationResult !== null) { result = validationResult; success = true; }

          if (result === null) {
            const safetyResult = await handleSafetyTool(toolName, toolArgs || {}, serverContext);
            if (safetyResult !== null) { result = safetyResult; success = true; }
          }

          if (result === null) {
            const contextResult = await handleContextTool(toolName, toolArgs || {}, serverContext);
            if (contextResult !== null) { result = contextResult; success = true; }
          }

          if (result === null) {
            const codeResult = await handleCodeTool(toolName, toolArgs || {}, serverContext);
            if (codeResult !== null) { result = codeResult; success = true; }
          }

          if (result === null) {
            error = `Unknown tool: ${toolName}`;
            success = false;
          }
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
          success = false;
        } finally {
          try { if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
        }

        const duration = Date.now() - callStart;

        // Estimate tokens & cost
        const resultText = typeof result === "string" ? result : JSON.stringify(result || "");
        const argsText = JSON.stringify(toolArgs || {});
        const inputTokens = Math.ceil(argsText.length / 4);
        const outputTokens = Math.ceil(resultText.length / 4);
        const cost = (inputTokens / 1000) * DEFAULT_COST_CONFIG.inputCostPer1k +
                     (outputTokens / 1000) * DEFAULT_COST_CONFIG.outputCostPer1k;

        // Build tool call entry
        const toolCallEntry: PlaygroundToolCall = {
          id: resolvedCallId,
          toolName,
          arguments: toolArgs || {},
          result,
          success,
          error,
          duration,
          timestamp: new Date().toISOString(),
          tokens: inputTokens + outputTokens,
          cost,
        };

        session.state.recentToolCalls = [...session.state.recentToolCalls.slice(-49), toolCallEntry];

        // Broadcast tool:end
        broadcastToSession(client.sessionId, { type: "tool:end", callId: resolvedCallId, entry: toolCallEntry });

        // Add CoT observation entry
        const obsEntry: PlaygroundCotEntry = {
          id: `cot-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
          type: "observation",
          content: success ? `Tool ${toolName} completed in ${duration}ms` : `Tool ${toolName} failed: ${error}`,
          timestamp: new Date().toISOString(),
          duration,
        };
        session.state.chainOfThought = [...session.state.chainOfThought.slice(-99), obsEntry];
        broadcastToSession(client.sessionId, { type: "cot:entry", entry: obsEntry });

        // Update rate limit display
        const minuteAgo = Date.now() - 60000;
        const hourAgo = Date.now() - 3600000;
        const rlEntry = rateLimitStore.get(client.apiKeyId);
        if (rlEntry) {
          session.state.rateLimitStatus = {
            minute: {
              used: rlEntry.timestamps.filter(t => t > minuteAgo).length,
              limit: client.rateLimits.requests_per_minute,
            },
            hour: {
              used: rlEntry.timestamps.filter(t => t > hourAgo).length,
              limit: client.rateLimits.requests_per_hour,
            },
          };
        }

        // Check rate limit warning at 80%
        const minuteUsed = session.state.rateLimitStatus.minute.used;
        const minuteLimit = session.state.rateLimitStatus.minute.limit;
        if (minuteUsed / minuteLimit >= 0.8) {
          broadcastToSession(client.sessionId, {
            type: "rate:warning",
            window: "minute",
            percentUsed: (minuteUsed / minuteLimit) * 100,
          });
        }

        session.lastActivity = Date.now();

        // Log usage
        logUsageEvent({
          apiKeyId: client.apiKeyId,
          toolName,
          durationMs: duration,
          success,
          error,
          tokensUsed: inputTokens + outputTokens,
        });
        break;
      }

      case "session:clear": {
        if (!client.sessionId) return;
        const session = playgroundSessions.get(client.sessionId);
        if (!session) return;
        session.state = createEmptySessionState();
        session.state.rateLimitStatus = {
          minute: { used: 0, limit: client.rateLimits.requests_per_minute },
          hour: { used: 0, limit: client.rateLimits.requests_per_hour },
        };
        broadcastToSession(client.sessionId, { type: "session:state", state: session.state });
        break;
      }

      default:
        sendToClient(client.ws, { type: "error", message: `Unknown message type: ${message.type}` });
    }
  }

  // Graceful shutdown
  const shutdown = () => {
    log("info", "Shutting down...");
    clearInterval(playgroundCleanupInterval);
    // Close all playground WebSocket connections
    for (const client of playgroundClients.values()) {
      client.ws.close(1001, "Server shutting down");
    }
    wss.close();
    // Disconnect Redis
    if (redisClient) {
      redisClient.disconnect();
      redisClient = null;
    }
    for (const transport of transports.values()) {
      transport.close().catch(() => {});
    }
    httpServer.close(() => {
      log("info", "Server stopped");
      process.exit(0);
    });
    // Force exit after 10s
    setTimeout(() => process.exit(1), 10000);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  httpServer.listen(port, host, () => {
    log("info", `Nella hosted MCP server listening on ${host}:${port}`, {
      endpoints: {
        mcp: `http://${host}:${port}/mcp`,
        health: `http://${host}:${port}/health`,
        playground: `ws://${host}:${port}/ws`,
        tools: `http://${host}:${port}/api/tools`,
      },
    });
  });
}

// =============================================================================
// Direct execution (for Docker CMD)
// =============================================================================

if (require.main === module) {
  startHostedServer().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
