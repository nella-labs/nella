/**
 * Structured Logger
 *
 * JSON structured logging for the API server.
 * Uses pino when available, falls back to console.
 */

type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

let pinoLogger: any = null;

try {
  const pino = require("pino");
  pinoLogger = pino({
    level: process.env.LOG_LEVEL || "info",
    ...(process.env.NODE_ENV !== "production" && {
      transport: { target: "pino/file", options: { destination: 1 } },
    }),
  });
} catch {
  // pino not available — use console fallback
}

export function log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...data,
  };

  if (pinoLogger) {
    pinoLogger[level](data || {}, message);
  } else {
    const fn =
      level === "fatal" || level === "error"
        ? console.error
        : level === "warn"
        ? console.warn
        : level === "debug" || level === "trace"
        ? console.debug
        : console.log;
    fn(JSON.stringify(entry));
  }
}
