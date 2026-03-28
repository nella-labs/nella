import * as os from "os";
import chalk from "chalk";
import figures from "figures";
import { agents, detectInstalledAgents, getAgent, getAllAgentNames } from "./agents";
import { writeAgentConfig } from "./installer";
import type { AgentType, ConnectMode, ConnectOptions, ConnectResult } from "./types";
import { getValidSession, createApiKey } from "../auth";

// Re-use nella's brand theme
const theme = {
  primary: chalk.hex("#2ECC71"),
  secondary: chalk.hex("#27AE60"),
  accent: chalk.hex("#F1C40F"),
  success: chalk.hex("#2ECC71"),
  error: chalk.hex("#EF4444"),
  warning: chalk.hex("#F59E0B"),
  muted: chalk.hex("#95A5A6"),
  dim: chalk.dim,
  bold: chalk.bold,
  icons: {
    success: chalk.hex("#2ECC71")(figures.tick),
    error: chalk.hex("#EF4444")(figures.cross),
    warning: chalk.hex("#F59E0B")(figures.warning),
    info: chalk.hex("#3498DB")(figures.info),
    arrow: chalk.hex("#2ECC71")(figures.arrowRight),
    star: chalk.hex("#F1C40F")(figures.star),
  },
};

export interface ConnectArgs {
  client?: string;
  mode?: string;
  apiKey?: string;
  serverUrl?: string;
  showHelp?: boolean;
}

function showConnectHelp(): void {
  const agentList = getAllAgentNames().map((n) => agents[n].displayName).join(", ");

  console.log(`  ${theme.primary.bold("nella connect")} — Configure coding agents to use Nella\n`);
  console.log(`  ${theme.primary.bold("Usage:")}\n`);
  console.log(`    ${theme.muted("$")} ${theme.primary("nella connect")}`);
  console.log(`    ${theme.muted("$")} ${theme.primary("nella connect --mode local")}`);
  console.log(`    ${theme.muted("$")} ${theme.primary("nella connect --mode hosted --api-key nella_xxx")}`);
  console.log(`    ${theme.muted("$")} ${theme.primary("nella connect --client claude-code")}`);
  console.log(`    ${theme.muted("$")} ${theme.primary("nella connect --client cursor --mode local")}\n`);
  console.log(`  ${theme.primary.bold("Options:")}\n`);
  console.log(`    ${theme.accent("--mode")} ${theme.muted("<mode>")}            ${theme.muted("hosted or local (default: auto)")}`);
  console.log(`    ${theme.accent("--client")} ${theme.muted("<name>")}          ${theme.muted("Target agent, or \"all\" (default: all detected)")}`);
  console.log(`    ${theme.accent("--api-key, -k")} ${theme.muted("<key>")}     ${theme.muted("API key for hosted mode")}`);
  console.log(`    ${theme.accent("--server-url, -u")} ${theme.muted("<url>")}  ${theme.muted("Server URL (default: production)")}`);
  console.log("");
  console.log(`  ${theme.primary.bold("Agents:")} ${theme.muted(agentList)}`);
  console.log("");
  console.log(`  ${theme.primary.bold("Modes:")}\n`);
  console.log(`    ${theme.accent("local")}   ${theme.muted("Runs MCP server locally via npx (no API key needed)")}`);
  console.log(`    ${theme.accent("hosted")}  ${theme.muted("Connects to Nella cloud (requires API key)")}`);
  console.log("");
}

async function resolveApiKey(providedKey?: string): Promise<string | undefined> {
  let apiKey = providedKey || process.env.NELLA_API_KEY;
  if (apiKey) return apiKey;

  const session = await getValidSession();
  if (!session) return undefined;

  console.log(`  ${theme.icons.info}  Logged in as ${theme.secondary(session.user.email)}`);
  console.log(`  ${theme.muted("   Creating API key automatically...")}\n`);

  const keyName = `cli-${os.hostname()}-${new Date().toISOString().slice(0, 10)}`;
  const { apiKey: newKey, error } = await createApiKey(session, keyName);

  if (newKey) {
    console.log(`  ${theme.icons.success}  API key created: ${theme.dim(newKey.substring(0, 15) + "...")}\n`);
    return newKey;
  }

  console.log(`  ${theme.icons.error}  Failed to create key: ${error}`);
  return undefined;
}

function resolveMode(args: ConnectArgs): ConnectMode {
  if (args.mode === "hosted") return "hosted";
  if (args.mode === "local") return "local";
  // Auto-detect: if API key is available, default to hosted; otherwise local
  if (args.apiKey || process.env.NELLA_API_KEY) return "hosted";
  return "local";
}

function resolveTargetAgents(clientArg?: string): AgentType[] {
  if (!clientArg || clientArg === "all") {
    return detectInstalledAgents();
  }

  // Support old client names for backward compat
  const aliasMap: Record<string, AgentType> = {
    claude: "claude-desktop",
    vscode: "vscode",
    cursor: "cursor",
  };

  const agentName = (aliasMap[clientArg] || clientArg) as AgentType;
  const agent = getAgent(agentName);

  if (!agent) {
    console.log(`  ${theme.icons.error}  Unknown agent: ${theme.accent(clientArg)}`);
    console.log(`  ${theme.muted("   Available:")} ${getAllAgentNames().join(", ")}\n`);
    process.exit(1);
  }

  return [agentName];
}

async function verifyServer(serverUrl: string): Promise<void> {
  try {
    const http = require("http");
    const https = require("https");
    const healthUrl = serverUrl.replace(/\/mcp$/, "/health");
    const mod = healthUrl.startsWith("https") ? https : http;

    const healthCheck = await new Promise<{ ok: boolean; version?: string }>((resolve) => {
      const req = mod.get(healthUrl, (res: { statusCode?: number; on: Function }) => {
        let data = "";
        res.on("data", (chunk: string) => { data += chunk; });
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            resolve({ ok: res.statusCode === 200, version: json.version });
          } catch {
            resolve({ ok: false });
          }
        });
      });
      req.on("error", () => resolve({ ok: false }));
      req.setTimeout(5000, () => { req.destroy(); resolve({ ok: false }); });
    });

    if (healthCheck.ok) {
      console.log(`  ${theme.icons.success}  Server reachable ${theme.muted(`(v${healthCheck.version})`)}`);
    } else {
      console.log(`  ${theme.icons.warning}  Server unreachable — config will be written anyway`);
    }
  } catch {
    console.log(`  ${theme.icons.warning}  Could not verify server — config will be written anyway`);
  }
}

export async function runConnectCommand(args: ConnectArgs, logo: string, tagline: string): Promise<void> {
  console.log(logo);
  console.log(tagline);

  if (args.showHelp) {
    showConnectHelp();
    return;
  }

  // 1. Resolve mode
  let mode = resolveMode(args);
  const serverUrl = args.serverUrl || "https://mcp.getnella.dev/mcp";

  // 2. For hosted mode, resolve API key
  let apiKey: string | undefined;
  if (mode === "hosted") {
    apiKey = await resolveApiKey(args.apiKey);
    if (!apiKey) {
      // Fall back to local mode if no API key available
      console.log(`  ${theme.icons.info}  No API key available — using ${theme.accent("local")} mode\n`);
      mode = "local";
    } else if (!apiKey.startsWith("nella_")) {
      console.log(`  ${theme.icons.error}  API key must start with ${theme.accent("nella_")}\n`);
      process.exit(1);
    }
  }

  // 3. Resolve target agents
  const targetAgents = resolveTargetAgents(args.client);

  if (targetAgents.length === 0) {
    console.log(`  ${theme.icons.warning}  No coding agents detected on this system.\n`);
    console.log(`  ${theme.muted("   Supported:")} ${getAllAgentNames().join(", ")}`);
    console.log(`  ${theme.muted("   Use")} ${theme.accent("--client <name>")} ${theme.muted("to configure a specific agent")}\n`);
    return;
  }

  // 4. Display connection info
  console.log(`  ${theme.icons.info}  ${theme.bold("Connecting to Nella")} ${theme.muted(`(${mode} mode)`)}\n`);
  if (mode === "hosted") {
    console.log(`  ${theme.muted("Server:")}  ${theme.secondary(serverUrl)}`);
    console.log(`  ${theme.muted("Key:")}     ${theme.dim(apiKey!.substring(0, 15) + "..." + apiKey!.slice(-4))}`);
    console.log("");
    await verifyServer(serverUrl);
  } else {
    console.log(`  ${theme.muted("Mode:")}    ${theme.secondary("Local MCP server via npx")}`);
  }
  console.log("");

  // 5. Configure each agent
  const results: ConnectResult[] = [];
  const connectOptions: ConnectOptions = { mode, serverUrl, apiKey };

  for (const agentName of targetAgents) {
    const agent = agents[agentName];

    // Check mode compatibility
    if (!agent.supportedModes.includes(mode)) {
      if (mode === "hosted" && agent.supportedModes.includes("local")) {
        // Silently downgrade to local for agents that only support local
        results.push(writeAgentConfig(agent, { ...connectOptions, mode: "local" }));
        continue;
      }
      results.push({
        agent: agent.displayName,
        success: false,
        path: agent.getConfigPath(),
        mode,
        error: `does not support ${mode} mode`,
      });
      continue;
    }

    results.push(writeAgentConfig(agent, connectOptions));
  }

  // 6. Report results
  for (const r of results) {
    if (r.success) {
      console.log(`  ${theme.icons.success}  ${theme.success(r.agent)} ${theme.muted("configured")} ${theme.dim(`(${r.mode})`)}`);
      console.log(`     ${theme.muted(r.path)}`);
      if (r.postConfigureResult === "ok") {
        console.log(`     ${theme.muted("+ /nella slash command installed")}`);
      }
    } else {
      console.log(`  ${theme.icons.error}  ${theme.error(r.agent)} ${theme.muted("failed:")} ${r.error}`);
      console.log(`     ${theme.muted(r.path)}`);
    }
  }

  console.log("");

  const allSuccess = results.every((r) => r.success);
  if (allSuccess && results.length > 0) {
    console.log(`  ${theme.icons.star}  ${theme.success.bold("All set!")} ${theme.muted("Restart your agents to connect.")}\n`);
  } else if (results.some((r) => r.success)) {
    console.log(`  ${theme.icons.warning}  ${theme.warning("Some agents failed to configure. Check paths above.")}\n`);
  }
}
