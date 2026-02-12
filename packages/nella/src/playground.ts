/**
 * Playground Server Launcher
 *
 * Starts the Nella playground server for real-time agent monitoring.
 * Optionally clones a Git repo to use as the workspace.
 */

import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { execSync } from "child_process";
import { createPlaygroundServer } from "@usenella/core";

export interface PlaygroundOptions {
  workspace?: string;
  port?: number;
  host?: string;
  /** Git repo URL or local path to clone / use */
  repo?: string;
  /** Enable TLS */
  tls?: boolean;
  /** Path to TLS certificate */
  cert?: string;
  /** Path to TLS private key */
  key?: string;
  /** Max concurrent WebSocket connections */
  maxConnections?: number;
  /** Enable authentication */
  auth?: boolean;
}

/**
 * If `repo` looks like a Git URL, clone it to a temp directory and return the path.
 * If it's a local path, just resolve and return it.
 */
function resolveRepo(repo: string): string {
  const isGitUrl =
    repo.startsWith("https://") ||
    repo.startsWith("git@") ||
    repo.startsWith("http://") ||
    repo.endsWith(".git");

  if (!isGitUrl) {
    // Treat as local path
    const resolved = path.resolve(repo);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Repo path does not exist: ${resolved}`);
    }
    return resolved;
  }

  // Extract repo name from URL
  const repoName = path.basename(repo, ".git").replace(/[^a-zA-Z0-9_-]/g, "_");
  const cloneDir = path.join(os.tmpdir(), "nella-playground", repoName);

  if (fs.existsSync(path.join(cloneDir, ".git"))) {
    console.log(`[Playground] Repo already cloned, pulling latest...`);
    try {
      execSync("git pull --ff-only", { cwd: cloneDir, stdio: "pipe" });
    } catch {
      console.log(`[Playground] Pull failed, using existing clone`);
    }
    return cloneDir;
  }

  console.log(`[Playground] Cloning ${repo}...`);
  fs.mkdirSync(path.dirname(cloneDir), { recursive: true });
  execSync(`git clone --depth 1 ${repo} ${cloneDir}`, { stdio: "inherit" });
  return cloneDir;
}

export async function startPlaygroundServer(options: PlaygroundOptions): Promise<void> {
  let workspacePath: string;

  if (options.repo) {
    workspacePath = resolveRepo(options.repo);
    console.log(`[Playground] Using repo workspace: ${workspacePath}`);
  } else {
    workspacePath = options.workspace
      ? path.resolve(options.workspace)
      : process.cwd();
  }

  const storagePath = path.join(workspacePath, ".nella");

  const server = createPlaygroundServer({
    workspacePath,
    storagePath,
    port: options.port ?? 3847,
    host: options.host ?? "localhost",
    tls: options.tls,
    tlsCert: options.cert,
    tlsKey: options.key,
    maxConnections: options.maxConnections,
    authEnabled: options.auth ?? false,
  });

  // Handle graceful shutdown
  const shutdown = async () => {
    console.log("\n[Playground] Shutting down...");
    await server.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const proto = options.tls ? "https" : "http";
  const wsproto = options.tls ? "wss" : "ws";

  server.on({
    onStart: (port) => {
      console.log(`\n  ✓ Playground server running`);
      console.log(`  → Dashboard: ${proto}://localhost:${port}/`);
      console.log(`  → WebSocket: ${wsproto}://localhost:${port}/ws`);
      console.log(`  → Metrics:   ${proto}://localhost:${port}/metrics`);
      console.log(`  → Workspace: ${workspacePath}`);
      if (options.tls) console.log(`  → TLS: enabled`);
      if (options.auth) console.log(`  → Auth: enabled`);
      if (options.maxConnections) console.log(`  → Max connections: ${options.maxConnections}`);
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
