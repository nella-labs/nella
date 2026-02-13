/**
 * Nella API Server
 *
 * Entry point for the REST API service.
 * Starts Express server with WebSocket support, graceful shutdown.
 *
 * Usage:
 *   node packages/api/dist/server.js
 *   PORT=8080 node packages/api/dist/server.js
 */

import path from "path";
import dotenv from "dotenv";

// Load .env from repo root
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config();

import { loadConfig } from "./config";
import { createApp } from "./app";
import { createWebSocketServer } from "./websocket/server";
import { initJobQueue, shutdownJobQueue } from "./jobs/queue";
import { log } from "./utils/logger";

async function main() {
  const config = loadConfig();

  log("info", "Starting Nella API server", {
    port: config.PORT,
    host: config.HOST,
    env: config.NODE_ENV,
  });

  // Create Express app
  const app = createApp();

  // Start HTTP server
  const server = app.listen(config.PORT, config.HOST, () => {
    log("info", `Nella API listening on ${config.HOST}:${config.PORT}`, {
      version: require("../package.json").version,
    });
  });

  // Attach WebSocket server
  const wss = createWebSocketServer(server);

  // Initialize background job queue
  try {
    await initJobQueue();
    log("info", "Background job queue initialized");
  } catch (err) {
    log("warn", "Background job queue unavailable (Redis may not be configured)", {
      error: (err as Error).message,
    });
  }

  // ---------------------------------------------------------------------------
  // Graceful Shutdown
  // ---------------------------------------------------------------------------
  const shutdown = async (signal: string) => {
    log("info", `Received ${signal}, shutting down gracefully...`);

    // Stop accepting new connections
    server.close(() => {
      log("info", "HTTP server closed");
    });

    // Close WebSocket connections
    wss.clients.forEach((client) => {
      client.close(1001, "Server shutting down");
    });
    wss.close();

    // Drain job queue
    try {
      await shutdownJobQueue();
    } catch {
      // best-effort
    }

    // Give in-flight requests 10s to finish
    setTimeout(() => {
      log("warn", "Forceful shutdown after timeout");
      process.exit(1);
    }, 10_000);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Fatal error starting Nella API:", err);
  process.exit(1);
});
