/**
 * Playground Module
 *
 * Real-time WebSocket server for nella playground with live updates
 * for tool calls, chain of thought, cost tracking, and more.
 */

// Types
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
} from "./types";

export { DEFAULT_SERVER_CONFIG, DEFAULT_COST_CONFIG } from "./types";

// Server
export { PlaygroundServer, createPlaygroundServer } from "./server";
export type { WebSocketClient, ServerEventHandlers } from "./server";

// Logger
export { createLogger, generateCorrelationId } from "./logger";
export type { Logger, LogLevel, LogEntry } from "./logger";

// Metrics
export { createPlaygroundMetrics } from "./metrics";
export type {
  PlaygroundMetrics,
  MetricsRegistry,
  Counter,
  Histogram,
  Gauge,
} from "./metrics";

// Auth Middleware
export { createAuthMiddleware } from "./middleware/auth";
export type { AuthConfig, AuthResult, AuthMiddleware } from "./middleware/auth";

// Session Store
export { createSessionStore } from "./session-store";
export type { SessionStore } from "./session-store";
