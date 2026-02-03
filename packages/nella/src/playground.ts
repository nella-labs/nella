/**
 * Playground Server Launcher
 *
 * Starts the Nella playground server for real-time agent monitoring.
 */

import * as path from "path";
import { createPlaygroundServer } from "@usenella/core";

export interface PlaygroundOptions {
  workspace?: string;
  port?: number;
  host?: string;
}

export async function startPlaygroundServer(options: PlaygroundOptions): Promise<void> {
  const workspacePath = options.workspace
    ? path.resolve(options.workspace)
    : process.cwd();

  const storagePath = path.join(workspacePath, ".nella");

  const server = createPlaygroundServer({
    workspacePath,
    storagePath,
    port: options.port ?? 3847,
    host: options.host ?? "localhost",
  });

  // Handle graceful shutdown
  const shutdown = async () => {
    console.log("\n[Playground] Shutting down...");
    await server.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  server.on({
    onStart: (port) => {
      console.log(`\n  ✓ Playground server running`);
      console.log(`  → Dashboard: http://localhost:${port}/`);
      console.log(`  → WebSocket: ws://localhost:${port}/ws`);
      console.log(`  → Workspace: ${workspacePath}`);
      console.log(`\n  Press Ctrl+C to stop\n`);
    },
    onClientConnect: (id) => {
      console.log(`  [connect] Client ${id.slice(0, 12)}...`);
    },
    onClientDisconnect: (id) => {
      console.log(`  [disconnect] Client ${id.slice(0, 12)}...`);
    },
    onError: (error) => {
      console.error(`  [error] ${error.message}`);
    },
  });

  await server.start();

  // Keep process alive
  await new Promise(() => {});
}
