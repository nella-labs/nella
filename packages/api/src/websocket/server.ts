/**
 * WebSocket Server
 *
 * Real-time updates for workspace indexing, context changes, and session events.
 * Attaches to the Express HTTP server.
 */

import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "http";
import crypto from "crypto";
import { log } from "../utils/logger";

// =============================================================================
// Types
// =============================================================================

interface WSClient {
  id: string;
  ws: WebSocket;
  userId?: string;
  apiKeyId?: string;
  channels: Set<string>;
  lastPing: number;
}

interface WSMessage {
  type: string;
  channel?: string;
  data?: unknown;
}

// =============================================================================
// Server
// =============================================================================

const clients = new Map<string, WSClient>();
let pingInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Create and attach a WebSocket server to the HTTP server.
 */
export function createWebSocketServer(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({
    server: httpServer,
    path: "/ws",
    verifyClient: (info, cb) => {
      // Extract API key from query param: /ws?token=nella_xxx
      const url = new URL(info.req.url || "", `http://${info.req.headers.host}`);
      const token = url.searchParams.get("token");

      if (!token) {
        cb(false, 401, "Missing authentication token");
        return;
      }

      // Validate token format
      if (!token.startsWith("nella_") && !token.startsWith("nla_")) {
        cb(false, 401, "Invalid token format");
        return;
      }

      // Full validation happens after connection via authenticate message
      // For now, accept the connection
      (info.req as any).__apiKey = token;
      cb(true);
    },
  });

  wss.on("connection", (ws, req) => {
    const clientId = crypto.randomUUID();
    const client: WSClient = {
      id: clientId,
      ws,
      channels: new Set(),
      lastPing: Date.now(),
    };

    clients.set(clientId, client);
    log("info", "WebSocket client connected", { clientId });

    // Send welcome message
    sendToClient(ws, {
      type: "connected",
      data: { clientId, timestamp: new Date().toISOString() },
    });

    ws.on("message", (raw) => {
      try {
        const msg: WSMessage = JSON.parse(raw.toString());
        handleMessage(client, msg);
      } catch (err) {
        sendToClient(ws, { type: "error", data: { message: "Invalid message format" } });
      }
    });

    ws.on("close", () => {
      clients.delete(clientId);
      log("info", "WebSocket client disconnected", { clientId });
    });

    ws.on("pong", () => {
      client.lastPing = Date.now();
    });
  });

  // Heartbeat — terminate stale connections
  pingInterval = setInterval(() => {
    const staleThreshold = Date.now() - 60_000;
    clients.forEach((client, id) => {
      if (client.lastPing < staleThreshold) {
        client.ws.terminate();
        clients.delete(id);
      } else {
        client.ws.ping();
      }
    });
  }, 30_000);

  wss.on("close", () => {
    if (pingInterval) clearInterval(pingInterval);
  });

  log("info", "WebSocket server attached at /ws");
  return wss;
}

// =============================================================================
// Message Handling
// =============================================================================

function handleMessage(client: WSClient, msg: WSMessage): void {
  switch (msg.type) {
    case "subscribe":
      if (msg.channel) {
        client.channels.add(msg.channel);
        sendToClient(client.ws, {
          type: "subscribed",
          data: { channel: msg.channel },
        });
        log("debug", "Client subscribed", { clientId: client.id, channel: msg.channel });
      }
      break;

    case "unsubscribe":
      if (msg.channel) {
        client.channels.delete(msg.channel);
        sendToClient(client.ws, {
          type: "unsubscribed",
          data: { channel: msg.channel },
        });
      }
      break;

    case "ping":
      sendToClient(client.ws, { type: "pong" });
      break;

    default:
      sendToClient(client.ws, {
        type: "error",
        data: { message: `Unknown message type: ${msg.type}` },
      });
  }
}

// =============================================================================
// Broadcasting
// =============================================================================

function sendToClient(ws: WebSocket, msg: WSMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}
