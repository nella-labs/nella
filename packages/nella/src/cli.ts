#!/usr/bin/env node

/**
 * Nella CLI
 *
 * Commands:
 *   nella index      - Index workspace for search & code verification
 *   nella mcp        - Start MCP server for AI agent integration
 *   nella connect    - Configure Claude, VS Code & Cursor
 *   nella auth       - Login, logout, or check status
 *
 * MCP Quick Start:
 *   npx -y @getnella/mcp --workspace /path/to/repo  # starts MCP server directly
 *   nella mcp --workspace /path/to/repo             # equivalent CLI form
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import chalk from "chalk";
import Table from "cli-table3";
import figures from "figures";
import {
  createIndexManager,
  DEFAULT_INDEX_CONFIG,
  buildDependencyGraph,
  dependencyGraphToArchgraphModel,
} from "@usenella/core";
import type { IndexManagerConfig, IndexEvent } from "@usenella/core";
import { startMcpServer } from "./mcp/server";
import { startHostedServer } from "./mcp/hosted-server";
import {
  login,
  loadSession,
  clearSession,
  getValidSession,
  createApiKey,
} from "./auth";
import { runConnectCommand } from "./connect";

// =============================================================================
// Theme & Styling
// =============================================================================

// Read version from package.json
const PKG_VERSION = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"));
    return pkg.version || "0.0.0";
  } catch { return "0.0.0"; }
})();

const theme = {
  // Brand colors — Nella green identity
  primary: chalk.hex("#2ECC71"),      // Nella green (from logo)
  secondary: chalk.hex("#27AE60"),    // Darker green
  accent: chalk.hex("#F1C40F"),       // Gold

  // Status colors
  success: chalk.hex("#2ECC71"),      // Nella green
  error: chalk.hex("#EF4444"),        // Red
  warning: chalk.hex("#F59E0B"),      // Amber
  info: chalk.hex("#3498DB"),         // Soft blue

  // Text colors
  muted: chalk.hex("#95A5A6"),        // Light gray
  dim: chalk.dim,
  bold: chalk.bold,

  // Icons
  icons: {
    success: chalk.hex("#2ECC71")(figures.tick),
    error: chalk.hex("#EF4444")(figures.cross),
    warning: chalk.hex("#F59E0B")(figures.warning),
    info: chalk.hex("#3498DB")(figures.info),
    arrow: chalk.hex("#2ECC71")(figures.arrowRight),
    bullet: chalk.hex("#95A5A6")(figures.bullet),
    star: chalk.hex("#F1C40F")(figures.star),
  },
};

// ASCII art logo with green gradient (bright → dark from top to bottom)
const g1 = chalk.hex("#5BF5A0"); // Lightest
const g2 = chalk.hex("#3DE87D");
const g3 = chalk.hex("#2ECC71"); // Brand green
const g4 = chalk.hex("#27AE60");
const g5 = chalk.hex("#1F8A4C");
const g6 = chalk.hex("#176E3A"); // Darkest

const logo = `
${g1("  ███╗   ██╗")}${g1("███████╗")}${g1("██╗     ██╗      █████╗ ")}
${g2("  ████╗  ██║")}${g2("██╔════╝")}${g2("██║     ██║     ██╔══██╗")}
${g3("  ██╔██╗ ██║")}${g3("█████╗  ")}${g3("██║     ██║     ███████║")}
${g4("  ██║╚██╗██║")}${g4("██╔══╝  ")}${g4("██║     ██║     ██╔══██║")}
${g5("  ██║ ╚████║")}${g5("███████╗")}${g5("███████╗███████╗██║  ██║")}
${g6("  ╚═╝  ╚═══╝")}${g6("╚══════╝")}${g6("╚══════╝╚══════╝╚═╝  ╚═╝")}
`;

const tagline = `  ${theme.muted("Reliability layer for coding agents")}  ${chalk.dim(`v${PKG_VERSION}`)}\n`;

function sectionHeader(title: string): string {
  const line = theme.muted("─".repeat(Math.max(0, 40 - title.length)));
  return `  ${theme.primary("┌")} ${theme.primary.bold(title)} ${line}`;
}

function box(content: string, title?: string): string {
  const lines = content.split("\n");
  const maxLen = Math.max(...lines.map(l => l.replace(/\x1b\[[0-9;]*m/g, "").length), (title?.length ?? 0) + 4);
  const width = Math.min(maxLen + 4, 70);

  const borderColor = chalk.hex("#27AE60");

  const top = title
    ? `${borderColor("╔═")} ${theme.primary.bold(title)} ${borderColor("═".repeat(Math.max(0, width - title.length - 5)) + "╗")}`
    : borderColor("╔" + "═".repeat(width) + "╗");
  const bottom = borderColor("╚" + "═".repeat(width) + "╝");

  const boxedLines = lines.map(line => {
    const cleanLen = line.replace(/\x1b\[[0-9;]*m/g, "").length;
    const padding = " ".repeat(Math.max(0, width - cleanLen - 2));
    return `${borderColor("║")} ${line}${padding} ${borderColor("║")}`;
  });

  return [top, ...boxedLines, bottom].join("\n");
}

function divider(): string {
  return `  ${theme.muted("─".repeat(20))} ${theme.primary("✦")} ${theme.muted("─".repeat(20))}`;
}

// =============================================================================
// Argument Parsing
// =============================================================================

interface CliArgs {
  command: "index" | "mcp" | "serve" | "connect" | "auth" | "setup" | "help";
  force?: boolean;
  repoPath?: string;
  output?: "json" | "pretty";
  // MCP-specific args
  workspace?: string;
  // Playground-specific args
  port?: number;
  host?: string;
  // Connect-specific args
  apiKey?: string;
  serverUrl?: string;
  client?: string;
  mode?: string;
  yes?: boolean;
  // Auth-specific args
  authSubcommand?: "login" | "logout" | "status";
  // Graph flag
  graph?: boolean;
  // Help flag (per-command)
  showHelp?: boolean;
}

function parseArgs(args: string[]): CliArgs {
  const result: CliArgs = {
    command: "help",
    output: "pretty",
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    // Commands
    if (arg === "index" || arg === "mcp" || arg === "serve" || arg === "connect" || arg === "auth" || arg === "setup" || arg === "help") {
      result.command = arg as CliArgs["command"];

      // Parse auth subcommand
      if (arg === "auth" && i + 1 < args.length) {
        const sub = args[i + 1];
        if (sub === "login" || sub === "logout" || sub === "status") {
          result.authSubcommand = sub;
          i++; // consume subcommand
        }
      }

      i++;
      continue;
    }

    // Options
    if (arg === "--repo" || arg === "-r") {
      result.repoPath = args[++i];
    } else if (arg === "--force" || arg === "-f") {
      result.force = true;
    } else if (arg === "--json") {
      result.output = "json";
    } else if (arg === "--graph") {
      result.graph = true;
    } else if (arg === "--help" || arg === "-h") {
      if (result.command === "help") {
        // No command set yet — show global help
        result.command = "help";
      } else {
        // Command already set — show command-specific help
        result.showHelp = true;
      }
    } else if (arg === "--workspace" || arg === "-w") {
      result.workspace = args[++i];
    } else if (arg.startsWith("--workspace=")) {
      result.workspace = arg.slice("--workspace=".length);
    } else if (arg === "--port" || arg === "-p") {
      result.port = parseInt(args[++i], 10);
    } else if (arg.startsWith("--port=")) {
      result.port = parseInt(arg.slice("--port=".length), 10);
    } else if (arg === "--host") {
      result.host = args[++i];
    } else if (arg.startsWith("--host=")) {
      result.host = arg.slice("--host=".length);
    } else if (arg === "--api-key" || arg === "-k") {
      result.apiKey = args[++i];
    } else if (arg.startsWith("--api-key=")) {
      result.apiKey = arg.slice("--api-key=".length);
    } else if (arg === "--server-url" || arg === "-u") {
      result.serverUrl = args[++i];
    } else if (arg.startsWith("--server-url=")) {
      result.serverUrl = arg.slice("--server-url=".length);
    } else if (arg === "--client") {
      result.client = args[++i];
    } else if (arg.startsWith("--client=")) {
      result.client = arg.slice("--client=".length);
    } else if (arg === "--mode") {
      result.mode = args[++i];
    } else if (arg.startsWith("--mode=")) {
      result.mode = arg.slice("--mode=".length);
    } else if (arg === "--yes" || arg === "-y") {
      result.yes = true;
    }

    i++;
  }

  return result;
}


// =============================================================================
// Auth Command
// =============================================================================

async function runAuthCommand(args: CliArgs): Promise<void> {
  console.log(logo);
  console.log(tagline);

  const sub = args.authSubcommand;

  if (!sub || args.showHelp) {
    console.log(`  ${theme.primary.bold("nella auth")} — Manage authentication\n`);
    console.log(`  ${theme.primary.bold("Usage:")}\n`);
    console.log(`    ${theme.muted("$")} ${theme.primary("nella auth login")}    ${theme.muted("Log in with your Nella account")}`);
    console.log(`    ${theme.muted("$")} ${theme.primary("nella auth logout")}   ${theme.muted("Clear stored credentials")}`);
    console.log(`    ${theme.muted("$")} ${theme.primary("nella auth status")}   ${theme.muted("Show current login state")}`);
    console.log("");
    return;
  }

  if (sub === "login") {
    console.log(`  ${theme.icons.info}  ${theme.bold("Log in to Nella")}\n`);

    const result = await login();

    if (result.success) {
      console.log(`\n  ${theme.icons.success}  ${theme.success.bold("Logged in")} as ${theme.secondary(result.email!)}`);
      console.log(`  ${theme.muted("   Session saved to ~/.nella/auth.json")}\n`);
      console.log(`  ${theme.muted("Next:")} ${theme.secondary("nella connect")} to configure your MCP clients\n`);
    } else {
      console.log(`\n  ${theme.icons.error}  ${theme.error.bold("Login failed:")} ${result.error}\n`);
      process.exit(1);
    }
    return;
  }

  if (sub === "logout") {
    clearSession();
    console.log(`  ${theme.icons.success}  ${theme.success("Logged out")} \u2014 credentials removed\n`);
    return;
  }

  if (sub === "status") {
    const session = await getValidSession();
    if (session) {
      console.log(`  ${theme.icons.success}  ${theme.success.bold("Authenticated")}\n`);
      console.log(`  ${theme.muted("Email:")}   ${theme.secondary(session.user.email)}`);
      console.log(`  ${theme.muted("User ID:")} ${theme.dim(session.user.id)}`);
      const exp = new Date(session.expires_at * 1000);
      console.log(`  ${theme.muted("Expires:")} ${theme.dim(exp.toLocaleString())}`);
    } else {
      console.log(`  ${theme.icons.warning}  ${theme.warning("Not logged in")}`);
      console.log(`\n  ${theme.muted("Run")} ${theme.secondary("nella auth login")} ${theme.muted("to authenticate")}`);
    }
    console.log("");
    return;
  }
}


// =============================================================================
// Index Command — index workspace for search & code verification
// =============================================================================

async function runIndexCommand(args: CliArgs): Promise<void> {
  if (args.showHelp) {
    console.log(logo);
    console.log(tagline);
    console.log(`  ${theme.primary.bold("nella index")} — Index workspace for search & code verification\n`);
    console.log(`  ${theme.primary.bold("Usage:")}\n`);
    console.log(`    ${theme.muted("$")} ${theme.primary("nella index [--workspace <path>] [--force] [--graph]")}\n`);
    console.log(`  ${theme.primary.bold("Options:")}\n`);
    console.log(`    ${theme.accent("--workspace, -w")} ${theme.muted("<path>")}    Workspace path (default: cwd)`);
    console.log(`    ${theme.accent("--force, -f")}                    Force full reindex`);
    console.log(`    ${theme.accent("--graph")}                        Generate dependency graph from index`);
    console.log("");
    return;
  }

  const workspacePath = path.resolve(args.workspace || process.cwd());
  const workspaceId = path.basename(workspacePath);
  const storagePath = path.join(workspacePath, ".nella", "index");
  const graphOnly = args.graph && !args.force;
  const needsIndex = !graphOnly;

  console.log(logo);
  console.log(tagline);

  if (graphOnly) {
    console.log(`  ${theme.icons.arrow}  Generating dependency graph for ${theme.primary.bold(workspacePath)}\n`);
  } else {
    console.log(`  ${theme.icons.arrow}  Indexing ${theme.primary.bold(workspacePath)}\n`);
  }

  if (args.force) {
    console.log(`  ${theme.muted("Mode: full reindex (--force)")}\n`);
  }

  // Resolve embedder config — graph-only mode doesn't need auth
  let embedderConfig: IndexManagerConfig["embedder"];
  if (needsIndex) {
    const session = await getValidSession();
    if (session) {
      console.log(`  ${theme.icons.info}  Using Nella cloud embeddings ${theme.muted(`(${session.user.email})`)}\n`);
      embedderConfig = {
        provider: "nella",
        model: "text-embedding-3-small",
        dimensions: 1536,
        apiKey: session.access_token,
        apiBase: "https://app.getnella.dev/api",
      };
    } else if (process.env.AZURE_EMBEDDING_API_KEY) {
      console.log(`  ${theme.muted("Using Azure OpenAI embeddings")}\n`);
      embedderConfig = {
        provider: "azure",
        model: "text-embedding-3-small",
        dimensions: 1536,
      };
    } else {
      console.log(`  ${theme.icons.error}  ${theme.error("Not authenticated. Run")} ${theme.primary.bold("nella auth login")} ${theme.error("first.")}\n`);
      process.exit(1);
    }
  } else {
    // Dummy config for graph-only mode (embedder is never called)
    embedderConfig = {
      provider: "azure",
      model: "text-embedding-3-small",
      dimensions: 1536,
    };
  }

  const config: IndexManagerConfig = {
    workspaceId,
    workspacePath,
    storagePath,
    chunking: {
      maxTokens: 512,
      overlap: 50,
      strategy: "ast",
    },
    embedder: embedderConfig,
    search: {
      vectorWeight: 0.4,
      lexicalWeight: 0.6,
      rerankEnabled: true,
      topK: 10,
    },
    include: DEFAULT_INDEX_CONFIG.include,
    exclude: [...DEFAULT_INDEX_CONFIG.exclude, "**/.nella/**"],
  };

  const manager = createIndexManager(config);

  // Run indexing if needed
  if (needsIndex) {
    let lastProgressLine = "";
    manager.onEvent((event: IndexEvent) => {
      switch (event.type) {
        case "index:start":
          console.log(`  ${theme.icons.info}  Found ${theme.primary.bold(String(event.totalFiles))} files to process\n`);
          break;
        case "index:progress": {
          const pct = Math.round((event.processed / event.total) * 100);
          lastProgressLine = `  ${theme.muted(`[${pct}%]`)} ${theme.muted(event.currentFile)}`;
          process.stderr.write(`\r${lastProgressLine}${"".padEnd(20)}`);
          break;
        }
        case "index:embed":
          process.stderr.write("\r" + " ".repeat(80) + "\r");
          console.log(`  ${theme.icons.info}  Embedded batch of ${theme.primary(String(event.batchSize))} chunks ${theme.muted(`(${event.tokensUsed} tokens)`)}`);
          break;
        case "index:error":
          process.stderr.write("\r" + " ".repeat(80) + "\r");
          console.log(`  ${theme.icons.error}  ${theme.error(event.error)} ${event.filePath ? theme.muted(event.filePath) : ""}`);
          break;
        case "index:complete":
          process.stderr.write("\r" + " ".repeat(80) + "\r");
          break;
      }
    });

    try {
      const metadata = await manager.index({ force: args.force });
      const stats = metadata.stats;

      console.log("");
      console.log(box([
        `${theme.icons.success}  ${theme.success.bold("Index Complete")}`,
        "",
        `   Files indexed:    ${theme.primary.bold(String(stats.filesIndexed))}`,
        `   Chunks created:   ${theme.primary.bold(String(stats.chunksCount))}`,
        `   Embeddings:       ${theme.primary.bold(String(stats.embeddingsCount))}`,
        `   API tokens:       ${theme.primary.bold(String(stats.totalTokens))}`,
        ...(stats.totalCost != null ? [`   Cost:             ${theme.primary.bold("$" + stats.totalCost.toFixed(4))}`] : []),
        ...(stats.durationMs != null ? [`   Duration:         ${theme.primary.bold((stats.durationMs / 1000).toFixed(1) + "s")}`] : []),
        "",
        `   Storage: ${theme.muted(path.relative(workspacePath, storagePath) + "/")}`,
      ].join("\n"), "Index"));
      console.log("");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log("");
      console.log(`  ${theme.icons.error}  ${theme.error.bold("Indexing failed")}`);
      console.log(`  ${theme.muted(message)}`);
      console.log("");
      process.exit(1);
    }
  }

  // Generate dependency graph if requested
  if (args.graph) {
    const chunks = manager.getAllChunks();
    if (chunks.length === 0) {
      console.log(`  ${theme.icons.error}  No index data found. Run ${theme.primary.bold("nella index")} first.\n`);
      process.exit(1);
    }

    console.log(`  ${theme.icons.info}  Building dependency graph from ${theme.primary.bold(String(chunks.length))} chunks...\n`);

    const graph = buildDependencyGraph(chunks, { workspacePath });
    const model = dependencyGraphToArchgraphModel(graph, workspaceId);

    // Write model
    const graphDir = path.join(workspacePath, ".nella", "graph");
    if (!fs.existsSync(graphDir)) fs.mkdirSync(graphDir, { recursive: true });
    const modelPath = path.join(graphDir, "model.json");
    fs.writeFileSync(modelPath, JSON.stringify(model, null, 2));

    console.log(box([
      `${theme.icons.success}  ${theme.success.bold("Dependency Graph")}`,
      "",
      `   Files:          ${theme.primary.bold(String(graph.files.size))}`,
      `   Dependencies:   ${theme.primary.bold(String(graph.edges.filter(e => !e.isExternal).length))}`,
      `   Packages:       ${theme.primary.bold(String(graph.externalPackages.size))}`,
      `   Circular deps:  ${graph.circularDependencies.length > 0
        ? theme.warning.bold(String(graph.circularDependencies.length))
        : theme.success.bold("0")}`,
      "",
      `   Output: ${theme.muted(path.relative(workspacePath, modelPath))}`,
    ].join("\n"), "Graph"));

    if (graph.circularDependencies.length > 0) {
      console.log(`\n  ${theme.icons.warning}  ${theme.warning("Circular dependencies:")}`);
      for (const cycle of graph.circularDependencies.slice(0, 5)) {
        console.log(`    ${theme.muted(cycle.join(" → "))}`);
      }
      if (graph.circularDependencies.length > 5) {
        console.log(`    ${theme.muted(`... and ${graph.circularDependencies.length - 5} more`)}`);
      }
    }

    console.log(`\n  ${theme.muted("View with:")} archgraph serve --model ${path.relative(workspacePath, modelPath)}\n`);
  }
}

function showHelp(): void {
  console.log(logo);
  console.log(tagline);

  // Quick start
  console.log(`  ${theme.muted("Quick start:")} ${theme.primary("npx -y @getnella/mcp")} ${theme.muted("--workspace ./my-project")}`);
  console.log("");

  const tableChars = {
    "top": "", "top-mid": "", "top-left": "", "top-right": "",
    "bottom": "", "bottom-mid": "", "bottom-left": "", "bottom-right": "",
    "left": "    ", "left-mid": "", "mid": "", "mid-mid": "",
    "right": "", "right-mid": "", "middle": "  ",
  };
  const tableStyle = { "padding-left": 0, "padding-right": 2 };

  // Core commands
  console.log(sectionHeader("Core"));
  const valTable = new Table({ chars: tableChars, style: tableStyle });
  valTable.push(
    [theme.primary("index"), theme.muted("Index workspace for search & code verification")],
  );
  console.log(valTable.toString());
  console.log("");

  // Server commands
  console.log(sectionHeader("Servers"));
  const srvTable = new Table({ chars: tableChars, style: tableStyle });
  srvTable.push(
    [theme.primary("mcp"), theme.muted("Start MCP server for AI agents (stdio)")],
    [theme.primary("serve"), theme.muted("Start hosted MCP server (HTTP)")],
);
  console.log(srvTable.toString());
  console.log("");

  // Setup commands
  console.log(sectionHeader("Setup"));
  const setupTable = new Table({ chars: tableChars, style: tableStyle });
  setupTable.push(
    [theme.primary("connect"), theme.muted("Configure coding agents to use Nella")],
    [theme.primary("auth"), theme.muted("Login, logout, or check status")],
    [theme.primary("setup"), theme.muted("Alias for connect --client claude-code")],
    [theme.primary("help"), theme.muted("Show this help message")],
  );
  console.log(setupTable.toString());
  console.log("");

  // Options
  console.log(sectionHeader("Options"));
  const optTable = new Table({ chars: tableChars, style: tableStyle });
  optTable.push(
    [theme.accent("--workspace, -w"), theme.muted("<path>"), "Workspace path (mcp)"],
    [theme.accent("--port, -p"), theme.muted("<num>"), "Server port (default: 3847)"],
    [theme.accent("--host"), theme.muted("<host>"), "Server host (default: localhost)"],
    [theme.accent("--api-key, -k"), theme.muted("<key>"), "API key for connect"],
    [theme.accent("--server-url, -u"), theme.muted("<url>"), "Server URL for connect"],
    [theme.accent("--client"), theme.muted("<name>"), "Target agent (default: all detected)"],
    [theme.accent("-y, --yes"), "", "Skip confirmation prompts"],
    [theme.accent("--force, -f"), "", "Force full reindex"],
    [theme.accent("--json"), "", "Output as JSON"],
    [theme.accent("--help, -h"), "", "Show help"],
  );
  console.log(optTable.toString());
  console.log("");

  // Footer
  console.log(divider());
  console.log(`\n  ${theme.muted("Docs")}  ${theme.secondary("https://getnella.dev/docs")}`);
  console.log(`  ${theme.muted("Repo")}  ${theme.secondary("https://github.com/nella-labs/nella")}`);
  console.log("");
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  switch (args.command) {
    case "index":
      await runIndexCommand(args);
      break;
    case "mcp":
      if (args.showHelp) {
        console.log(logo);
        console.log(tagline);
        console.log(`  ${theme.primary.bold("nella mcp")} — Start MCP server for AI agent integration (stdio)\n`);
        console.log(`  ${theme.primary.bold("Usage:")}\n`);
        console.log(`    ${theme.muted("$")} ${theme.primary("nella mcp [--workspace <path>]")}\n`);
        console.log(`  ${theme.primary.bold("Options:")}\n`);
        console.log(`    ${theme.accent("--workspace, -w")} ${theme.muted("<path>")}    Workspace path`);
        console.log("");
        break;
      }
      await startMcpServer({ workspace: args.workspace });
      break;
    case "serve":
      if (args.showHelp) {
        console.log(logo);
        console.log(tagline);
        console.log(`  ${theme.primary.bold("nella serve")} — Start hosted MCP server (HTTP)\n`);
        console.log(`  ${theme.primary.bold("Usage:")}\n`);
        console.log(`    ${theme.muted("$")} ${theme.primary("nella serve [--port <number>] [--host <host>]")}\n`);
        console.log(`  ${theme.primary.bold("Options:")}\n`);
        console.log(`    ${theme.accent("--port, -p")} ${theme.muted("<number>")}    Port (default: 3847)`);
        console.log(`    ${theme.accent("--host")} ${theme.muted("<host>")}           Host (default: localhost)`);
        console.log("");
        break;
      }
      await startHostedServer({ port: args.port, host: args.host });
      break;
    case "auth":
      await runAuthCommand(args);
      break;
    case "connect":
      await runConnectCommand(
        { client: args.client, mode: args.mode, apiKey: args.apiKey, serverUrl: args.serverUrl, showHelp: args.showHelp, yes: args.yes },
        logo, tagline,
      );
      break;
    case "setup":
      // Backward-compatible alias: setup → connect --client claude-code --mode local
      await runConnectCommand(
        { client: "claude-code", mode: "local", yes: true },
        logo, tagline,
      );
      break;
case "help":
    default:
      showHelp();
      break;
  }
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
