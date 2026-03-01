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
import chalk from "chalk";
import figures from "figures";
import { createPlaygroundServer } from "@usenella/core";

// Nella green theme (matches cli.ts)
const g = {
  primary: chalk.hex("#2ECC71"),
  secondary: chalk.hex("#27AE60"),
  muted: chalk.hex("#95A5A6"),
  error: chalk.hex("#EF4444"),
  ok: chalk.hex("#2ECC71")(figures.tick),
  arrow: chalk.hex("#2ECC71")(figures.arrowRight),
};

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
    console.log(`  ${g.muted("playground")} ${g.muted("▸")} pulling latest...`);
    try {
      execSync("git pull --ff-only", { cwd: cloneDir, stdio: "pipe" });
    } catch {
      console.log(`  ${g.muted("playground")} ${g.muted("▸")} pull failed, using existing clone`);
    }
    return cloneDir;
  }

  console.log(`  ${g.muted("playground")} ${g.muted("▸")} cloning ${g.secondary(repo)}`);
  fs.mkdirSync(path.dirname(cloneDir), { recursive: true });
  execSync("git clone --depth 1 -- " + JSON.stringify(repo) + " " + JSON.stringify(cloneDir), { stdio: "inherit" });
  return cloneDir;
}

export async function startPlaygroundServer(options: PlaygroundOptions): Promise<void> {
  let workspacePath: string;

  if (options.repo) {
    workspacePath = resolveRepo(options.repo);
    console.log(`  ${g.muted("playground")} ${g.muted("▸")} workspace ${g.secondary(workspacePath)}`);
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
    console.log(`\n  ${g.muted("playground")} ${g.muted("▸")} shutting down...`);
    await server.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const proto = options.tls ? "https" : "http";
  const wsproto = options.tls ? "wss" : "ws";

  server.on({
    onStart: (port) => {
      console.log("");
      console.log(`  ${g.ok}  ${g.primary.bold("Playground running")}`);
      console.log("");
      console.log(`  ${g.arrow}  ${g.muted("Dashboard")}  ${g.secondary(`${proto}://localhost:${port}/`)}`);
      console.log(`  ${g.arrow}  ${g.muted("WebSocket")}  ${g.secondary(`${wsproto}://localhost:${port}/ws`)}`);
      console.log(`  ${g.arrow}  ${g.muted("Metrics")}    ${g.secondary(`${proto}://localhost:${port}/metrics`)}`);
      console.log(`  ${g.arrow}  ${g.muted("Workspace")}  ${chalk.dim(workspacePath)}`);
      if (options.tls) console.log(`  ${g.arrow}  ${g.muted("TLS")}        ${g.primary("enabled")}`);
      if (options.auth) console.log(`  ${g.arrow}  ${g.muted("Auth")}       ${g.primary("enabled")}`);
      if (options.maxConnections) console.log(`  ${g.arrow}  ${g.muted("Max conn")}   ${g.primary(String(options.maxConnections))}`);
      console.log(`\n  ${g.muted("Press Ctrl+C to stop")}\n`);
    },
    onClientConnect: (id) => {
      console.log(`  ${g.ok}  ${g.muted("connected")}    ${chalk.dim(id.slice(0, 12) + "...")}`);
    },
    onClientDisconnect: (id) => {
      console.log(`  ${g.muted("○")}  ${g.muted("disconnected")} ${chalk.dim(id.slice(0, 12) + "...")}`);
    },
    onError: (error) => {
      console.error(`  ${chalk.hex("#EF4444")(figures.cross)}  ${g.error(error.message)}`);
    },
  });

  await server.start();

  // Keep process alive
  await new Promise(() => {});
}
