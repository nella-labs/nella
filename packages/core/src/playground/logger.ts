/**
 * Playground Logger
 *
 * Structured JSON logger with correlation IDs and level filtering.
 * Matches the pattern from hosted-server.ts for consistency.
 */

import * as crypto from "crypto";

// =============================================================================
// Types
// =============================================================================

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  correlationId?: string;
  [key: string]: unknown;
}

export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  child(correlationId: string): Logger;
}

// =============================================================================
// Level Priority
// =============================================================================

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// =============================================================================
// Correlation ID
// =============================================================================

/**
 * Generate a short correlation ID for request/message tracking
 */
export function generateCorrelationId(): string {
  return crypto.randomBytes(8).toString("hex");
}

// =============================================================================
// Logger Implementation
// =============================================================================

class PlaygroundLogger implements Logger {
  private prefix: string;
  private minLevel: LogLevel;
  private correlationId?: string;

  constructor(prefix: string, minLevel?: LogLevel, correlationId?: string) {
    this.prefix = prefix;
    this.minLevel = minLevel || (process.env.NELLA_LOG_LEVEL as LogLevel) || "info";
    this.correlationId = correlationId;
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log("debug", message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log("info", message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log("warn", message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.log("error", message, data);
  }

  /**
   * Create a child logger with a specific correlation ID
   */
  child(correlationId: string): Logger {
    return new PlaygroundLogger(this.prefix, this.minLevel, correlationId);
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.minLevel]) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message: `[${this.prefix}] ${message}`,
      ...(this.correlationId ? { correlationId: this.correlationId } : {}),
      ...data,
    };

    console.log(JSON.stringify(entry));
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a structured logger instance
 */
export function createLogger(prefix: string, minLevel?: LogLevel): Logger {
  return new PlaygroundLogger(prefix, minLevel);
}
