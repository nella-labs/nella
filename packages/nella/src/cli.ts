#!/usr/bin/env node

/**
 * Nella CLI
 *
 * Commands:
 *   nella index      - Index workspace for search & code verification
 *   nella search     - Search the indexed codebase
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
  BranchIndexManager,
  gitUtils,
} from "@usenella/core";
import type { IndexManagerConfig, IndexEvent, BranchIndexInfo } from "@usenella/core";
import { DEFAULT_EMBEDDING_MODEL, MODEL_DIMENSIONS } from "@usenella/core";
import { startMcpServer } from "./mcp/server";
import { startHostedServer } from "./mcp/hosted-server";
import {
  login,
  loadSession,
  clearSession,
  getValidSession,
  createApiKey,
  getActiveOrg,
  getActiveProject,
  switchOrg,
  switchProject,
  fetchOrganizations,
  fetchProjects,
} from "./auth";
import { runConnectCommand } from "./connect";
import {
  resolveEmbedderConfig,
  getOrCreateManager,
  getOrCreateBranchManager,
} from "./search-setup";
import { isTelemetryEnabled, setTelemetryEnabled, getTelemetryStatus, hasShownNotice, markNoticeShown, resetTelemetryId } from "./telemetry";
import { recordEvent } from "./telemetry-reporter";

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

const tagline = `  ${theme.muted("Codebase intelligence for AI agents")}  ${chalk.dim(`v${PKG_VERSION}`)}\n`;

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
  command: "index" | "search" | "mcp" | "serve" | "connect" | "auth" | "org" | "project" | "branch" | "setup" | "telemetry" | "help";
  force?: boolean;
  repoPath?: string;
  output?: "json" | "pretty";
  // MCP-specific args
  workspace?: string;
  // Server args
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
  // Org/project subcommands
  subcommand?: string;
  subcommandArg?: string;
  // Graph flag
  graph?: boolean;
  // Branch flag (for index/search commands)
  branch?: string;
  // Help flag (per-command)
  showHelp?: boolean;
  // Search-specific args
  searchQuery?: string;
  searchMode?: "hybrid" | "semantic" | "lexical";
  searchDetail?: "compact" | "full";
  topK?: number;
  language?: string;
  filePattern?: string;
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
    if (arg === "index" || arg === "search" || arg === "mcp" || arg === "serve" || arg === "connect" || arg === "auth" || arg === "org" || arg === "project" || arg === "branch" || arg === "setup" || arg === "telemetry" || arg === "help") {
      result.command = arg as CliArgs["command"];

      // Parse auth subcommand
      if (arg === "auth" && i + 1 < args.length) {
        const sub = args[i + 1];
        if (sub === "login" || sub === "logout" || sub === "status") {
          result.authSubcommand = sub;
          i++; // consume subcommand
        }
      }

      // Parse org/project/branch subcommand + optional argument
      if ((arg === "org" || arg === "project" || arg === "branch") && i + 1 < args.length) {
        const sub = args[i + 1];
        if (sub && !sub.startsWith("-")) {
          result.subcommand = sub;
          i++;
          // Check for subcommand argument (e.g. slug for switch)
          if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
            result.subcommandArg = args[i + 1];
            i++;
          }
        }
      }

      // Parse telemetry subcommand
      if (arg === "telemetry" && i + 1 < args.length) {
        const sub = args[i + 1];
        if (sub && !sub.startsWith("-")) {
          result.subcommand = sub;
          i++;
        }
      }

      // Parse search query (first non-flag arg after "search")
      if (arg === "search" && i + 1 < args.length && !args[i + 1].startsWith("-")) {
        result.searchQuery = args[i + 1];
        i++;
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
    } else if (arg === "--branch" || arg === "-b") {
      result.branch = args[++i];
    } else if (arg.startsWith("--branch=")) {
      result.branch = arg.slice("--branch=".length);
    } else if (arg === "--detail") {
      const val = args[++i];
      if (val === "compact" || val === "full") result.searchDetail = val;
    } else if (arg.startsWith("--detail=")) {
      const val = arg.slice("--detail=".length);
      if (val === "compact" || val === "full") result.searchDetail = val as "compact" | "full";
    } else if (arg === "--top-k") {
      result.topK = parseInt(args[++i], 10);
    } else if (arg.startsWith("--top-k=")) {
      result.topK = parseInt(arg.slice("--top-k=".length), 10);
    } else if (arg === "--language" || arg === "-l") {
      result.language = args[++i];
    } else if (arg.startsWith("--language=")) {
      result.language = arg.slice("--language=".length);
    } else if (arg === "--file-pattern") {
      result.filePattern = args[++i];
    } else if (arg.startsWith("--file-pattern=")) {
      result.filePattern = arg.slice("--file-pattern=".length);
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
      if (session.org) {
        console.log(`  ${theme.muted("Org:")}     ${theme.secondary(session.org.name)} ${theme.dim(`@${session.org.slug}`)}`);
      }
      if (session.project) {
        console.log(`  ${theme.muted("Project:")} ${theme.secondary(session.project.name)} ${theme.dim(`@${session.project.slug}`)}`);
      }
    } else {
      console.log(`  ${theme.icons.warning}  ${theme.warning("Not logged in")}`);
      console.log(`\n  ${theme.muted("Run")} ${theme.secondary("nella auth login")} ${theme.muted("to authenticate")}`);
    }
    console.log("");
    return;
  }
}


// =============================================================================
// Org Command
// =============================================================================

async function runOrgCommand(args: CliArgs): Promise<void> {
  console.log(logo);
  console.log(tagline);

  const sub = args.subcommand;

  if (!sub || args.showHelp) {
    console.log(`  ${theme.primary.bold("nella org")} — Manage organizations\n`);
    console.log(`  ${theme.primary.bold("Usage:")}\n`);
    console.log(`    ${theme.muted("$")} ${theme.primary("nella org list")}              ${theme.muted("List your organizations")}`);
    console.log(`    ${theme.muted("$")} ${theme.primary("nella org switch <slug>")}     ${theme.muted("Switch active organization")}`);
    console.log("");
    return;
  }

  const session = await getValidSession();
  if (!session) {
    console.log(`  ${theme.icons.error}  ${theme.error("Not logged in.")} Run ${theme.primary.bold("nella auth login")} first.\n`);
    process.exit(1);
  }

  if (sub === "list") {
    const orgs = await fetchOrganizations(session);
    const activeOrg = getActiveOrg();

    console.log(`  ${theme.primary.bold("Organizations")}\n`);
    for (const org of orgs) {
      const active = activeOrg?.id === org.id ? theme.success(" (active)") : "";
      const personal = org.is_personal ? theme.muted(" · personal") : "";
      console.log(`  ${active ? theme.icons.success : theme.icons.bullet}  ${theme.bold(org.name)} ${theme.muted(`@${org.slug}`)} ${theme.dim(`[${org.role}]`)}${personal}${active}`);
    }
    console.log("");
    return;
  }

  if (sub === "switch") {
    const slug = args.subcommandArg;
    if (!slug) {
      console.log(`  ${theme.icons.error}  ${theme.error("Usage:")} nella org switch <slug>\n`);
      process.exit(1);
    }

    const orgs = await fetchOrganizations(session);
    const target = orgs.find((o) => o.slug === slug);
    if (!target) {
      console.log(`  ${theme.icons.error}  ${theme.error(`Organization "${slug}" not found.`)}\n`);
      console.log(`  ${theme.muted("Available:")} ${orgs.map((o) => o.slug).join(", ")}\n`);
      process.exit(1);
    }

    switchOrg({ id: target.id, name: target.name, slug: target.slug });

    // Auto-select first project in the new org
    try {
      const projects = await fetchProjects(session, target.id);
      if (projects.length > 0) {
        switchProject({ id: projects[0].id, name: projects[0].name, slug: projects[0].slug });
        console.log(`  ${theme.icons.success}  Switched to ${theme.primary.bold(target.name)} ${theme.muted(`@${target.slug}`)}`);
        console.log(`  ${theme.muted("Active project:")} ${projects[0].name}\n`);
      } else {
        console.log(`  ${theme.icons.success}  Switched to ${theme.primary.bold(target.name)} ${theme.muted(`@${target.slug}`)}\n`);
      }
    } catch {
      console.log(`  ${theme.icons.success}  Switched to ${theme.primary.bold(target.name)} ${theme.muted(`@${target.slug}`)}\n`);
    }
    return;
  }

  console.log(`  ${theme.icons.error}  Unknown subcommand: ${sub}\n`);
  process.exit(1);
}

// =============================================================================
// Project Command
// =============================================================================

async function runProjectCommand(args: CliArgs): Promise<void> {
  console.log(logo);
  console.log(tagline);

  const sub = args.subcommand;

  if (!sub || args.showHelp) {
    console.log(`  ${theme.primary.bold("nella project")} — Manage projects\n`);
    console.log(`  ${theme.primary.bold("Usage:")}\n`);
    console.log(`    ${theme.muted("$")} ${theme.primary("nella project list")}              ${theme.muted("List projects in current org")}`);
    console.log(`    ${theme.muted("$")} ${theme.primary("nella project switch <slug>")}     ${theme.muted("Switch active project")}`);
    console.log(`    ${theme.muted("$")} ${theme.primary("nella project link")}              ${theme.muted("Link current workspace to active project")}`);
    console.log(`    ${theme.muted("$")} ${theme.primary("nella project unlink")}            ${theme.muted("Unlink workspace from project")}`);
    console.log("");
    return;
  }

  const session = await getValidSession();
  if (!session) {
    console.log(`  ${theme.icons.error}  ${theme.error("Not logged in.")} Run ${theme.primary.bold("nella auth login")} first.\n`);
    process.exit(1);
  }

  const activeOrg = getActiveOrg();
  if (!activeOrg) {
    console.log(`  ${theme.icons.error}  ${theme.error("No active organization.")} Run ${theme.primary.bold("nella org switch <slug>")} first.\n`);
    process.exit(1);
  }

  if (sub === "list") {
    const projects = await fetchProjects(session, activeOrg.id);
    const activeProject = getActiveProject();

    console.log(`  ${theme.primary.bold("Projects")} ${theme.muted(`in ${activeOrg.name}`)}\n`);
    for (const proj of projects) {
      const active = activeProject?.id === proj.id ? theme.success(" (active)") : "";
      const desc = proj.description ? theme.muted(` — ${proj.description}`) : "";
      console.log(`  ${active ? theme.icons.success : theme.icons.bullet}  ${theme.bold(proj.name)} ${theme.muted(`@${proj.slug}`)}${desc}${active}`);
    }
    console.log("");
    return;
  }

  if (sub === "switch") {
    const slug = args.subcommandArg;
    if (!slug) {
      console.log(`  ${theme.icons.error}  ${theme.error("Usage:")} nella project switch <slug>\n`);
      process.exit(1);
    }

    const projects = await fetchProjects(session, activeOrg.id);
    const target = projects.find((p) => p.slug === slug);
    if (!target) {
      console.log(`  ${theme.icons.error}  ${theme.error(`Project "${slug}" not found in ${activeOrg.name}.`)}\n`);
      console.log(`  ${theme.muted("Available:")} ${projects.map((p) => p.slug).join(", ")}\n`);
      process.exit(1);
    }

    switchProject({ id: target.id, name: target.name, slug: target.slug });
    console.log(`  ${theme.icons.success}  Switched to project ${theme.primary.bold(target.name)} ${theme.muted(`@${target.slug}`)}\n`);
    return;
  }

  if (sub === "link") {
    const activeProject = getActiveProject();
    if (!activeProject) {
      console.log(`  ${theme.icons.error}  ${theme.error("No active project.")} Run ${theme.primary.bold("nella project switch <slug>")} first.\n`);
      process.exit(1);
    }

    const workspacePath = path.resolve(args.workspace || process.cwd());
    const workspaceId = path.basename(workspacePath);

    // Load local registry and update the workspace entry
    const registryPath = path.join(os.homedir(), ".nella", "registry.json");
    let registry: { workspaces: Array<Record<string, unknown>> } = { workspaces: [] };
    if (fs.existsSync(registryPath)) {
      try {
        registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
      } catch {
        // Start fresh
      }
    }

    const entry = registry.workspaces.find(
      (w) => w.path === workspacePath || w.id === workspaceId
    );
    if (entry) {
      entry.orgId = activeOrg.id;
      entry.projectId = activeProject.id;
    } else {
      registry.workspaces.push({
        id: workspaceId,
        name: workspaceId,
        path: workspacePath,
        createdAt: new Date().toISOString(),
        lastAccessed: new Date().toISOString(),
        indexStatus: "none",
        stats: { filesIndexed: 0, chunksCount: 0, totalTokens: 0 },
        orgId: activeOrg.id,
        projectId: activeProject.id,
      });
    }

    const registryDir = path.dirname(registryPath);
    if (!fs.existsSync(registryDir)) fs.mkdirSync(registryDir, { recursive: true });
    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + "\n", "utf-8");

    console.log(`  ${theme.icons.success}  Linked ${theme.primary.bold(workspacePath)}`);
    console.log(`  ${theme.muted("  →")} ${activeOrg.name} / ${activeProject.name}\n`);
    return;
  }

  if (sub === "unlink") {
    const workspacePath = path.resolve(args.workspace || process.cwd());
    const workspaceId = path.basename(workspacePath);
    const registryPath = path.join(os.homedir(), ".nella", "registry.json");

    if (!fs.existsSync(registryPath)) {
      console.log(`  ${theme.icons.warning}  No workspace registry found.\n`);
      return;
    }

    const registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
    const entry = registry.workspaces?.find(
      (w: Record<string, unknown>) => w.path === workspacePath || w.id === workspaceId
    );
    if (entry) {
      delete entry.orgId;
      delete entry.projectId;
      fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + "\n", "utf-8");
      console.log(`  ${theme.icons.success}  Unlinked ${theme.primary.bold(workspacePath)} from project\n`);
    } else {
      console.log(`  ${theme.icons.warning}  Workspace not found in registry.\n`);
    }
    return;
  }

  console.log(`  ${theme.icons.error}  Unknown subcommand: ${sub}\n`);
  process.exit(1);
}

// =============================================================================
// Branch Command
// =============================================================================

async function runBranchCommand(args: CliArgs): Promise<void> {
  console.log(logo);
  console.log(tagline);

  const sub = args.subcommand;
  const workspacePath = path.resolve(args.workspace || process.cwd());

  if (args.showHelp || sub === "help") {
    console.log(`  ${theme.primary.bold("nella branch")} — Manage branch indexes\n`);
    console.log(`  ${theme.primary.bold("Usage:")}\n`);
    console.log(`    ${theme.muted("$")} ${theme.primary("nella branch")}                     ${theme.muted("Show current branch and index status")}`);
    console.log(`    ${theme.muted("$")} ${theme.primary("nella branch list")}                ${theme.muted("List all branch indexes")}`);
    console.log(`    ${theme.muted("$")} ${theme.primary("nella branch switch <name>")}       ${theme.muted("Switch active branch index")}`);
    console.log(`    ${theme.muted("$")} ${theme.primary("nella branch delete <name>")}       ${theme.muted("Delete a branch index")}`);
    console.log("");
    console.log(`  ${theme.primary.bold("Related:")}\n`);
    console.log(`    ${theme.muted("$")} ${theme.primary("nella index --branch <name>")}      ${theme.muted("Index a specific branch")}`);
    console.log("");
    return;
  }

  // Check if workspace is a git repo
  const isRepo = await gitUtils.isGitRepo(workspacePath);
  if (!isRepo) {
    console.log(`  ${theme.icons.error}  ${theme.error("Not a git repository:")} ${workspacePath}\n`);
    process.exit(1);
  }

  const currentBranch = await gitUtils.getCurrentBranch(workspacePath);
  const defaultBranch = await gitUtils.getDefaultBranch(workspacePath);

  // Create a BranchIndexManager for this workspace
  const storagePath = path.join(workspacePath, ".nella", "index");
  const branchManager = new BranchIndexManager({
    workspaceId: path.basename(workspacePath),
    workspacePath,
    baseStoragePath: storagePath,
    defaultBranch,
    indexConfig: {
      ...DEFAULT_INDEX_CONFIG,
      chunking: { maxTokens: 512, overlap: 50, strategy: "ast" },
    },
  });

  // Default: show current branch status
  if (!sub) {
    const info = branchManager.getBranchInfo(currentBranch);
    console.log(`  ${theme.primary.bold("Current Branch")}\n`);
    console.log(`  ${theme.icons.arrow}  Branch: ${theme.primary.bold(currentBranch)}${currentBranch === defaultBranch ? theme.muted(" (default)") : ""}`);

    if (info) {
      const statusColor = info.indexStatus === "ready" ? theme.success : info.indexStatus === "error" ? theme.error : theme.warning;
      console.log(`  ${theme.icons.bullet}  Index:  ${statusColor(info.indexStatus)}`);
      console.log(`  ${theme.icons.bullet}  Files:  ${theme.muted(String(info.stats.filesIndexed))}`);
      console.log(`  ${theme.icons.bullet}  Chunks: ${theme.muted(String(info.stats.chunksCount))}`);
      if (info.parentBranch !== currentBranch) {
        console.log(`  ${theme.icons.bullet}  Parent: ${theme.muted(info.parentBranch)}`);
      }
      console.log(`  ${theme.icons.bullet}  Updated: ${theme.muted(info.updatedAt)}`);
    } else {
      console.log(`  ${theme.icons.bullet}  Index:  ${theme.warning("not indexed")}`);
      console.log(`\n  ${theme.muted("Run")} ${theme.primary.bold("nella index")} ${theme.muted("to index this branch")}`);
    }
    console.log("");
    return;
  }

  // List all branch indexes
  if (sub === "list") {
    const branches = branchManager.listBranches();
    console.log(`  ${theme.primary.bold("Branch Indexes")} ${theme.muted(`(${branches.length})`)}\n`);

    if (branches.length === 0) {
      console.log(`  ${theme.muted("No branch indexes found. Run")} ${theme.primary.bold("nella index")} ${theme.muted("to create one.")}\n`);
      return;
    }

    const table = new Table({
      head: ["Branch", "Status", "Files", "Chunks", "Parent", "Updated"].map((h) => theme.muted(h)),
      style: { head: [], border: [] },
      chars: {
        top: "", "top-mid": "", "top-left": "", "top-right": "",
        bottom: "", "bottom-mid": "", "bottom-left": "", "bottom-right": "",
        left: "  ", "left-mid": "", mid: "", "mid-mid": "",
        right: "", "right-mid": "", middle: "  ",
      },
    });

    for (const info of branches) {
      const isCurrent = info.name === currentBranch;
      const isDefault = info.name === defaultBranch;
      const name = isCurrent
        ? theme.primary.bold(`* ${info.name}`)
        : `  ${info.name}`;
      const statusColor = info.indexStatus === "ready" ? theme.success : info.indexStatus === "error" ? theme.error : theme.warning;
      const parent = isDefault ? theme.muted("-") : theme.muted(info.parentBranch);
      const updated = theme.muted(info.updatedAt.split("T")[0] || "-");

      table.push([
        name,
        statusColor(info.indexStatus),
        String(info.stats.filesIndexed),
        String(info.stats.chunksCount),
        parent,
        updated,
      ]);
    }

    console.log(table.toString());
    console.log("");
    return;
  }

  // Switch branch index
  if (sub === "switch") {
    const branchName = args.subcommandArg;
    if (!branchName) {
      console.log(`  ${theme.icons.error}  ${theme.error("Usage:")} nella branch switch <name>\n`);
      process.exit(1);
    }

    if (!branchManager.hasBranchIndex(branchName)) {
      console.log(`  ${theme.icons.warning}  No index for branch "${branchName}". Creating overlay...`);
      await branchManager.createBranchIndex(branchName);
    }

    console.log(`  ${theme.icons.success}  Switched to branch index: ${theme.primary.bold(branchName)}\n`);
    return;
  }

  // Delete branch index
  if (sub === "delete") {
    const branchName = args.subcommandArg;
    if (!branchName) {
      console.log(`  ${theme.icons.error}  ${theme.error("Usage:")} nella branch delete <name>\n`);
      process.exit(1);
    }

    if (branchName === defaultBranch) {
      console.log(`  ${theme.icons.error}  ${theme.error("Cannot delete the default branch index.")}\n`);
      process.exit(1);
    }

    if (!branchManager.hasBranchIndex(branchName)) {
      console.log(`  ${theme.icons.warning}  No index found for branch "${branchName}".\n`);
      return;
    }

    await branchManager.deleteBranchIndex(branchName);
    console.log(`  ${theme.icons.success}  Deleted branch index: ${theme.primary.bold(branchName)}\n`);
    return;
  }

  console.log(`  ${theme.icons.error}  Unknown subcommand: ${sub}\n`);
  process.exit(1);
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
        model: DEFAULT_EMBEDDING_MODEL,
        dimensions: MODEL_DIMENSIONS[DEFAULT_EMBEDDING_MODEL],
        apiKey: session.access_token,
        apiBase: "https://app.getnella.dev/api",
      };
    } else if (process.env.VOYAGE_API_KEY) {
      embedderConfig = {
        provider: "voyage",
        model: DEFAULT_EMBEDDING_MODEL,
        dimensions: MODEL_DIMENSIONS[DEFAULT_EMBEDDING_MODEL],
      };
    } else if (process.env.AZURE_EMBEDDING_API_KEY) {
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
      provider: "voyage",
      model: DEFAULT_EMBEDDING_MODEL,
      dimensions: MODEL_DIMENSIONS[DEFAULT_EMBEDDING_MODEL],
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
        ...(stats.durationMs != null ? [`   Duration:         ${theme.primary.bold((stats.durationMs / 1000).toFixed(1) + "s")}`] : []),
        "",
        `   Storage: ${theme.muted(path.relative(workspacePath, storagePath) + "/")}`,
      ].join("\n"), "Index"));
      console.log("");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log("");
      console.log(`  ${theme.icons.error}  ${theme.error.bold("Indexing failed")}`);
      console.log("");

      // Format error with actionable hints
      if (message.includes("Embedding service error") || message.includes("embedding")) {
        console.log(`  ${theme.error("Embedding Error")}`);
        console.log(`  ${theme.muted(message.replace(/^Embedding service error \(\d+\): /, ""))}`);
        console.log("");
        console.log(`  ${theme.muted("Possible fixes:")}`);
        console.log(`  ${theme.muted("  1. Check your Nella auth:")} ${theme.primary("nella auth status")}`);
        console.log(`  ${theme.muted("  2. Re-authenticate:")} ${theme.primary("nella auth login")}`);
        console.log(`  ${theme.muted("  3. If the issue persists, the embedding service may be temporarily unavailable.")}`);
      } else if (message.includes("Not authenticated") || message.includes("auth")) {
        console.log(`  ${theme.error("Authentication Error")}`);
        console.log(`  ${theme.muted(message)}`);
        console.log("");
        console.log(`  ${theme.muted("Run")} ${theme.primary("nella auth login")} ${theme.muted("to authenticate.")}`);
      } else {
        console.log(`  ${theme.muted(message)}`);
      }

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

// =============================================================================
// Search Command — search indexed codebase
// =============================================================================

async function runSearchCommand(args: CliArgs): Promise<void> {
  if (args.showHelp || !args.searchQuery) {
    console.log(logo);
    console.log(tagline);
    console.log(`  ${theme.primary.bold("nella search")} — Search the indexed codebase\n`);
    console.log(`  ${theme.primary.bold("Usage:")}\n`);
    console.log(`    ${theme.muted("$")} ${theme.primary('nella search "your query" [options]')}\n`);
    console.log(`  ${theme.primary.bold("Options:")}\n`);
    console.log(`    ${theme.accent("--mode")} ${theme.muted("<mode>")}              Search mode: hybrid, semantic, lexical (default: hybrid)`);
    console.log(`    ${theme.accent("--detail")} ${theme.muted("<level>")}           Output detail: compact, full (default: compact)`);
    console.log(`    ${theme.accent("--top-k")} ${theme.muted("<number>")}            Number of results (default: 5)`);
    console.log(`    ${theme.accent("--language, -l")} ${theme.muted("<lang>")}      Filter by language (e.g. typescript, python)`);
    console.log(`    ${theme.accent("--file-pattern")} ${theme.muted("<glob>")}      Filter by file path pattern (e.g. src/components/**)`);
    console.log(`    ${theme.accent("--branch, -b")} ${theme.muted("<name>")}        Search a specific branch index`);
    console.log(`    ${theme.accent("--workspace, -w")} ${theme.muted("<path>")}     Workspace path (default: cwd)`);
    console.log("");
    console.log(`  ${theme.primary.bold("Examples:")}\n`);
    console.log(`    ${theme.muted("$")} ${theme.primary('nella search "authentication flow"')}`);
    console.log(`    ${theme.muted("$")} ${theme.primary('nella search "handleSubmit" --mode lexical')}`);
    console.log(`    ${theme.muted("$")} ${theme.primary('nella search "database connection" --detail full --top-k 10')}`);
    console.log("");
    return;
  }

  const workspacePath = path.resolve(args.workspace || process.cwd());
  const query = args.searchQuery;
  const mode = (args.mode as "hybrid" | "semantic" | "lexical") || args.searchMode || "hybrid";
  const detail = args.searchDetail || "compact";
  const topK = args.topK || 5;
  const language = args.language;
  const filePattern = args.filePattern;
  const branch = args.branch;

  const searchFilter = {
    fileTypes: language ? [language] : undefined,
    paths: filePattern ? [filePattern] : undefined,
  };

  // Try branch-aware search first
  if (branch || await gitUtils.isGitRepo(workspacePath)) {
    try {
      const branchManager = await getOrCreateBranchManager(workspacePath);
      const targetBranch = branch || await branchManager.detectCurrentBranch();
      const response = await branchManager.searchBranch(targetBranch, {
        query, mode, limit: topK, filter: searchFilter,
      });

      printSearchResults(response, query, detail, workspacePath);
      return;
    } catch {
      // Fall back to flat manager if branch search fails
    }
  }

  // Flat index search
  const manager = await getOrCreateManager(workspacePath);
  const status = manager.getStatus();

  if (!status.ready) {
    console.log(`\n  ${theme.icons.warning}  ${theme.warning("Index is empty.")}`);
    console.log(`\n  ${theme.muted("Run")} ${theme.primary.bold("nella index")} ${theme.muted("first to index the workspace.")}\n`);
    process.exit(1);
  }

  try {
    const response = await manager.search({
      query, mode, limit: topK, filter: searchFilter,
    });

    printSearchResults(response, query, detail, workspacePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`\n  ${theme.icons.error}  ${theme.error.bold("Search failed:")}`);
    console.log(`  ${theme.muted(message)}\n`);
    process.exit(1);
  }
}

function printSearchResults(
  response: import("@usenella/core").SearchResponse,
  query: string,
  detail: "compact" | "full",
  workspacePath: string,
): void {
  if (response.results.length === 0) {
    console.log(`\n  ${theme.icons.warning}  ${theme.warning("No results")} for ${theme.bold(`"${query}"`)}`);
    console.log(`\n  ${theme.muted("Try broader terms, check spelling, or run")} ${theme.primary.bold("nella index")} ${theme.muted("if the workspace hasn't been indexed recently.")}\n`);
    return;
  }

  console.log(`\n  ${theme.icons.success}  Found ${theme.primary.bold(String(response.results.length))} results for ${theme.bold(`"${query}"`)}\n`);

  for (let i = 0; i < response.results.length; i++) {
    const result = response.results[i];
    const relPath = path.relative(workspacePath, result.chunk.filePath);
    const [startLine, endLine] = result.chunk.lines;
    const score = (result.score * 100).toFixed(1);
    const symbolNames = result.chunk.symbols.map((s) => s.name).join(", ");
    const symbolKinds = [...new Set(result.chunk.symbols.map((s) => s.kind))].join(", ");
    const symbolSuffix = symbolNames ? ` ${theme.muted("\u2014")} ${theme.secondary(symbolNames)} ${theme.muted(`[${symbolKinds}]`)}` : "";

    console.log(`  ${theme.primary.bold(`${i + 1}.`)} ${theme.bold(relPath)}:${theme.accent(`${startLine}-${endLine}`)} ${theme.muted(`(${score}%)`)}`);
    if (symbolSuffix) {
      console.log(`     ${symbolSuffix}`);
    }

    if (detail === "full") {
      const lang = result.chunk.language || "";
      const lines = result.chunk.content.split("\n");
      console.log(`     ${theme.muted("```" + lang)}`);
      for (const line of lines) {
        console.log(`     ${theme.dim(line)}`);
      }
      console.log(`     ${theme.muted("```")}`);
    }

    console.log("");
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
    [theme.primary("search"), theme.muted("Search the indexed codebase")],
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

  // Collaboration commands
  console.log(sectionHeader("Collaboration"));
  const collabTable = new Table({ chars: tableChars, style: tableStyle });
  collabTable.push(
    [theme.primary("org"), theme.muted("List or switch organizations")],
    [theme.primary("project"), theme.muted("List, switch, link/unlink projects")],
  );
  console.log(collabTable.toString());
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

// =============================================================================
// Telemetry Command
// =============================================================================

async function runTelemetryCommand(args: CliArgs): Promise<void> {
  console.log(logo);
  console.log(tagline);

  const sub = args.subcommand;

  if (!sub || sub === "status" || args.showHelp) {
    const status = getTelemetryStatus();
    console.log(`  ${theme.primary.bold("nella telemetry")} — Manage anonymous usage analytics\n`);
    console.log(`  ${theme.muted("Status:")}  ${status.enabled ? theme.success("Enabled") : theme.warning("Disabled")}${status.reason ? theme.dim(` (${status.reason})`) : ""}`);
    console.log(`  ${theme.muted("ID:")}      ${theme.dim(status.id)}\n`);
    console.log(`  ${theme.primary.bold("Commands:")}\n`);
    console.log(`    ${theme.muted("$")} ${theme.primary("nella telemetry status")}    ${theme.muted("Show current status")}`);
    console.log(`    ${theme.muted("$")} ${theme.primary("nella telemetry enable")}    ${theme.muted("Enable anonymous telemetry")}`);
    console.log(`    ${theme.muted("$")} ${theme.primary("nella telemetry disable")}   ${theme.muted("Disable anonymous telemetry")}`);
    console.log(`    ${theme.muted("$")} ${theme.primary("nella telemetry reset")}     ${theme.muted("Regenerate anonymous ID")}\n`);
    console.log(`  ${theme.muted("Environment variables:")}\n`);
    console.log(`    ${theme.accent("NELLA_TELEMETRY_DISABLED=1")}   ${theme.muted("Disable telemetry")}`);
    console.log(`    ${theme.accent("DO_NOT_TRACK=1")}               ${theme.muted("Disable telemetry (community standard)")}\n`);
    console.log(`  ${theme.muted("Learn more:")} ${theme.info("https://getnella.dev/docs/telemetry")}\n`);
    return;
  }

  if (sub === "enable") {
    setTelemetryEnabled(true);
    console.log(`  ${theme.icons.success}  ${theme.success("Telemetry enabled")} — anonymous usage data will be collected\n`);
    return;
  }

  if (sub === "disable") {
    setTelemetryEnabled(false);
    console.log(`  ${theme.icons.success}  ${theme.success("Telemetry disabled")} — no usage data will be collected\n`);
    return;
  }

  if (sub === "reset") {
    resetTelemetryId();
    const status = getTelemetryStatus();
    console.log(`  ${theme.icons.success}  ${theme.success("Telemetry ID reset")}`);
    console.log(`  ${theme.muted("New ID:")} ${theme.dim(status.id)}\n`);
    return;
  }

  console.log(`  ${theme.icons.error}  ${theme.error(`Unknown subcommand: ${sub}`)}`);
  console.log(`  ${theme.muted("Run")} ${theme.secondary("nella telemetry")} ${theme.muted("for usage")}\n`);
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Show first-run telemetry notice (once, to stderr so it doesn't interfere with MCP)
  if (!hasShownNotice() && args.command !== "telemetry") {
    markNoticeShown();
    if (isTelemetryEnabled()) {
      console.error("");
      console.error("  Nella collects anonymous usage data to improve the product.");
      console.error("  Run `nella telemetry disable` or set NELLA_TELEMETRY_DISABLED=1 to opt out.");
      console.error("  Learn more: https://getnella.dev/docs/telemetry");
      console.error("");
    }
  }

  // Track CLI command usage (anonymous)
  if (args.command !== "help" && args.command !== "telemetry") {
    recordEvent("cli_command", { command: args.command });
  }

  switch (args.command) {
    case "index":
      await runIndexCommand(args);
      break;
    case "search":
      await runSearchCommand(args);
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
    case "org":
      await runOrgCommand(args);
      break;
    case "project":
      await runProjectCommand(args);
      break;
    case "branch":
      await runBranchCommand(args);
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
    case "telemetry":
      await runTelemetryCommand(args);
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
