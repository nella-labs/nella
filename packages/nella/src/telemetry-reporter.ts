/**
 * Telemetry event reporter with offline queue support.
 *
 * - Buffers events in memory during CLI execution
 * - Flushes on process exit (non-blocking)
 * - Falls back to ~/.nella/telemetry-queue.json if network fails
 * - Retries queued events on next CLI run
 * - 2s HTTP timeout, fire-and-forget, never affects CLI performance
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as https from "https";
import { isTelemetryEnabled, getTelemetryId } from "./telemetry";

const NELLA_DIR = path.join(os.homedir(), ".nella");
const QUEUE_FILE = path.join(NELLA_DIR, "telemetry-queue.json");
const BATCH_ENDPOINT = "https://app.getnella.dev/api/analytics/batch";
const HTTP_TIMEOUT = 2000;

interface TelemetryEvent {
  event_name: string;
  properties?: Record<string, unknown>;
  anonymous_id: string;
  source: "cli" | "mcp";
  cli_version?: string;
  os?: string;
  arch?: string;
}

// In-memory event buffer
const eventBuffer: TelemetryEvent[] = [];
let flushScheduled = false;

// Read version once
let pkgVersion = "";
function getVersion(): string {
  if (pkgVersion) return pkgVersion;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"));
    pkgVersion = pkg.version || "0.0.0";
  } catch {
    pkgVersion = "0.0.0";
  }
  return pkgVersion;
}

/**
 * Record a telemetry event. No-op if telemetry is disabled.
 */
export function recordEvent(
  eventName: string,
  properties?: Record<string, unknown>
): void {
  if (!isTelemetryEnabled()) return;

  eventBuffer.push({
    event_name: eventName,
    properties,
    anonymous_id: getTelemetryId(),
    source: "cli",
    cli_version: getVersion(),
    os: process.platform,
    arch: process.arch,
  });

  scheduleFlush();
}

/**
 * Record an MCP tool call telemetry event.
 */
export function recordMcpEvent(
  toolName: string,
  durationMs: number,
  success: boolean
): void {
  if (!isTelemetryEnabled()) return;

  eventBuffer.push({
    event_name: "mcp_tool_call",
    properties: { tool_name: toolName, duration_ms: durationMs, success },
    anonymous_id: getTelemetryId(),
    source: "mcp",
    cli_version: getVersion(),
    os: process.platform,
    arch: process.arch,
  });

  scheduleFlush();
}

function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;

  // Flush on process exit
  process.on("beforeExit", () => {
    flush();
  });
}

/**
 * Flush buffered events + any queued events from disk.
 */
function flush(): void {
  const queued = loadQueue();
  const allEvents = [...queued, ...eventBuffer];
  eventBuffer.length = 0;

  if (allEvents.length === 0) return;

  // Fire-and-forget HTTP POST
  sendBatch(allEvents).catch(() => {
    // Network failed — persist to disk for next run
    saveQueue(allEvents);
  });
}

async function sendBatch(events: TelemetryEvent[]): Promise<void> {
  const body = JSON.stringify({ events });

  return new Promise<void>((resolve, reject) => {
    const url = new URL(BATCH_ENDPOINT);
    const req = https.request(
      {
        hostname: url.hostname,
        port: 443,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
        } else {
          // Clear queue on success
          clearQueue();
          resolve();
        }
      }
    );
    req.on("error", reject);
    req.setTimeout(HTTP_TIMEOUT, () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.write(body);
    req.end();
  });
}

function loadQueue(): TelemetryEvent[] {
  try {
    if (fs.existsSync(QUEUE_FILE)) {
      const raw = fs.readFileSync(QUEUE_FILE, "utf-8");
      const events = JSON.parse(raw);
      // Clear queue file once loaded
      clearQueue();
      return Array.isArray(events) ? events : [];
    }
  } catch {
    // Corrupted queue — discard
  }
  return [];
}

function saveQueue(events: TelemetryEvent[]): void {
  try {
    if (!fs.existsSync(NELLA_DIR)) {
      fs.mkdirSync(NELLA_DIR, { recursive: true });
    }
    // Keep max 200 events in queue
    const trimmed = events.slice(-200);
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(trimmed), "utf-8");
  } catch {
    // Non-critical
  }
}

function clearQueue(): void {
  try {
    if (fs.existsSync(QUEUE_FILE)) {
      fs.unlinkSync(QUEUE_FILE);
    }
  } catch {
    // Non-critical
  }
}
