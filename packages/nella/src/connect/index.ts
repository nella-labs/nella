import * as os from "os";
import * as p from "@clack/prompts";
import chalk from "chalk";
import { agents, detectInstalledAgents, getAgent, getAllAgentNames } from "./agents";
import { writeAgentConfig } from "./installer";
import type { AgentType, ConnectMode, ConnectOptions, ConnectResult } from "./types";
import { getValidSession, createApiKey } from "../auth";

const pc = {
  green: chalk.hex("#2ECC71"),
  dim: chalk.dim,
  cyan: chalk.hex("#3498DB"),
  yellow: chalk.hex("#F1C40F"),
  red: chalk.hex("#EF4444"),
  bold: chalk.bold,
  muted: chalk.hex("#95A5A6"),
};

export interface ConnectArgs {
  client?: string;
  mode?: string;
  apiKey?: string;
  serverUrl?: string;
  showHelp?: boolean;
  yes?: boolean;
}

// Backward compat alias map
const AGENT_ALIASES: Record<string, AgentType> = {
  claude: "claude-desktop",
  vscode: "vscode",
  cursor: "cursor",
};

function resolveAgentName(name: string): AgentType | undefined {
  const resolved = (AGENT_ALIASES[name] || name) as AgentType;
  return getAgent(resolved) ? resolved : undefined;
}

function showConnectHelp(): void {
  const agentList = getAllAgentNames().map((n) => agents[n].displayName).join(", ");

  console.log(`\n  ${pc.green.bold("nella connect")} — Configure coding agents to use Nella\n`);
  console.log(`  ${pc.green.bold("Usage:")}\n`);
  console.log(`    ${pc.muted("$")} ${pc.green("nella connect")}`);
  console.log(`    ${pc.muted("$")} ${pc.green("nella connect --mode local")}`);
  console.log(`    ${pc.muted("$")} ${pc.green("nella connect --mode hosted --api-key nella_xxx")}`);
  console.log(`    ${pc.muted("$")} ${pc.green("nella connect --client claude-code")}`);
  console.log(`    ${pc.muted("$")} ${pc.green("nella connect --client cursor --mode local -y")}\n`);
  console.log(`  ${pc.green.bold("Options:")}\n`);
  console.log(`    ${pc.yellow("--mode")} ${pc.muted("<mode>")}            ${pc.muted("hosted or local (default: interactive)")}`);
  console.log(`    ${pc.yellow("--client")} ${pc.muted("<name>")}          ${pc.muted("Target agent (skip agent selection)")}`);
  console.log(`    ${pc.yellow("--api-key, -k")} ${pc.muted("<key>")}     ${pc.muted("API key (skip key prompt)")}`);
  console.log(`    ${pc.yellow("--server-url, -u")} ${pc.muted("<url>")}  ${pc.muted("Server URL (default: production)")}`);
  console.log(`    ${pc.yellow("-y, --yes")}                ${pc.muted("Skip confirmation prompts")}`);
  console.log("");
  console.log(`  ${pc.green.bold("Agents:")} ${pc.muted(agentList)}`);
  console.log("");
}

async function verifyServer(serverUrl: string): Promise<{ ok: boolean; version?: string }> {
  try {
    const http = require("http");
    const https = require("https");
    const healthUrl = serverUrl.replace(/\/mcp$/, "/health");
    const mod = healthUrl.startsWith("https") ? https : http;

    return await new Promise<{ ok: boolean; version?: string }>((resolve) => {
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
  } catch {
    return { ok: false };
  }
}

function exitIfCancelled(value: unknown): void {
  if (p.isCancel(value)) {
    p.cancel("Connection cancelled");
    process.exit(0);
  }
}

export async function runConnectCommand(args: ConnectArgs, logo: string, _tagline: string): Promise<void> {
  if (args.showHelp) {
    console.log(logo);
    showConnectHelp();
    return;
  }

  const interactive = !args.yes;
  const serverUrl = args.serverUrl || "https://mcp.getnella.dev/mcp";

  p.intro(chalk.bgHex("#2ECC71").hex("#000")(" nella connect "));

  // ── Step 1: Detect & select agents ──

  const spin = p.spinner();
  spin.start("Detecting installed agents...");
  const detected = detectInstalledAgents();
  spin.stop(`${pc.green(String(detected.length))} agent${detected.length !== 1 ? "s" : ""} detected`);

  let targetAgents: AgentType[];

  if (args.client && args.client !== "all") {
    // Specific client requested — skip selection
    const resolved = resolveAgentName(args.client);
    if (!resolved) {
      p.log.error(`Unknown agent: ${pc.yellow(args.client)}`);
      p.log.message(pc.dim(`Available: ${getAllAgentNames().join(", ")}`));
      p.cancel("Invalid agent");
      process.exit(1);
    }
    targetAgents = [resolved];
    p.log.info(`Agent: ${pc.cyan(agents[resolved].displayName)}`);
  } else if (detected.length === 0) {
    p.log.warn("No coding agents detected on this system.");
    p.log.message(pc.dim(`Supported: ${getAllAgentNames().join(", ")}`));
    p.log.message(pc.dim(`Use --client <name> to configure a specific agent`));
    p.cancel("No agents found");
    process.exit(0);
  } else if (interactive) {
    const allNames = getAllAgentNames();
    const selected = await p.multiselect({
      message: "Which agents do you want to connect?",
      options: allNames.map((name) => ({
        value: name,
        label: agents[name].displayName,
        hint: detected.includes(name) ? "detected" : undefined,
      })),
      initialValues: detected,
      required: true,
    });

    exitIfCancelled(selected);
    targetAgents = selected as AgentType[];
  } else {
    targetAgents = detected;
    p.log.info(`Agents: ${detected.map((a) => pc.cyan(agents[a].displayName)).join(", ")}`);
  }

  // ── Step 2: Select connection mode ──

  let mode: ConnectMode;

  if (args.mode === "hosted" || args.mode === "local") {
    mode = args.mode;
    p.log.info(`Mode: ${pc.cyan(mode)}`);
  } else if (args.apiKey || process.env.NELLA_API_KEY) {
    mode = "hosted";
    p.log.info(`Mode: ${pc.cyan("hosted")} (API key provided)`);
  } else if (interactive) {
    const modeChoice = await p.select({
      message: "Connection mode",
      options: [
        {
          value: "local" as ConnectMode,
          label: "Local",
          hint: "Runs MCP server locally via npx (no API key needed)",
        },
        {
          value: "hosted" as ConnectMode,
          label: "Hosted",
          hint: "Connects to Nella cloud (requires API key)",
        },
      ],
    });

    exitIfCancelled(modeChoice);
    mode = modeChoice as ConnectMode;
  } else {
    mode = "local";
    p.log.info(`Mode: ${pc.cyan("local")}`);
  }

  // ── Step 3: Resolve API key (hosted mode only) ──

  let apiKey: string | undefined;

  if (mode === "hosted") {
    if (args.apiKey) {
      apiKey = args.apiKey;
    } else if (process.env.NELLA_API_KEY) {
      apiKey = process.env.NELLA_API_KEY;
      p.log.info(`Using API key from ${pc.cyan("NELLA_API_KEY")} env var`);
    } else if (interactive) {
      // Check if user is logged in
      const session = await getValidSession();

      const keyOptions: { value: string; label: string; hint?: string }[] = [
        { value: "existing", label: "Enter an existing API key" },
      ];

      if (session) {
        keyOptions.unshift({
          value: "create",
          label: "Create a new API key automatically",
          hint: `logged in as ${session.user.email}`,
        });
      }

      keyOptions.push({
        value: "skip",
        label: "Skip — switch to local mode instead",
      });

      const keyChoice = await p.select({
        message: "API Key",
        options: keyOptions,
      });

      exitIfCancelled(keyChoice);

      if (keyChoice === "create" && session) {
        spin.start("Creating API key...");
        const keyName = `cli-${os.hostname()}-${new Date().toISOString().slice(0, 10)}`;
        const { apiKey: newKey, error } = await createApiKey(session, keyName);

        if (newKey) {
          apiKey = newKey;
          spin.stop(`API key created: ${pc.dim(newKey.substring(0, 15) + "...")}`);
        } else {
          spin.stop(`Failed to create key: ${error}`);
          p.log.warn("Falling back to local mode");
          mode = "local";
        }
      } else if (keyChoice === "existing") {
        const keyInput = await p.text({
          message: "Enter your API key",
          placeholder: "nella_your_key_here",
          validate: (val) => {
            if (!val.trim()) return "API key is required";
            if (!val.startsWith("nella_")) return "API key must start with nella_";
            return undefined;
          },
        });

        exitIfCancelled(keyInput);
        apiKey = keyInput as string;
      } else {
        // Skip — switch to local
        mode = "local";
        p.log.info(`Switched to ${pc.cyan("local")} mode`);
      }
    } else {
      // Non-interactive, no key available
      p.log.warn("No API key available — switching to local mode");
      mode = "local";
    }

    if (mode === "hosted" && apiKey && !apiKey.startsWith("nella_")) {
      p.log.error("API key must start with nella_");
      p.cancel("Invalid API key");
      process.exit(1);
    }
  }

  // ── Step 4: Connection summary ──

  const summaryLines: string[] = [];
  summaryLines.push(`  ${pc.bold("Mode:")}    ${mode}`);

  if (mode === "hosted") {
    summaryLines.push(`  ${pc.bold("Server:")}  ${serverUrl}`);
    summaryLines.push(`  ${pc.bold("Key:")}     ${pc.dim(apiKey!.substring(0, 15) + "..." + apiKey!.slice(-4))}`);
  } else {
    summaryLines.push(`  ${pc.bold("Server:")}  Local MCP via npx @getnella/mcp`);
  }

  const agentNames = targetAgents.map((a) => agents[a].displayName);
  summaryLines.push(`  ${pc.bold("Agents:")}  ${agentNames.join(", ")}`);

  p.note(summaryLines.join("\n"), "Connection Summary");

  // ── Step 5: Confirmation ──

  if (interactive) {
    const confirmed = await p.confirm({ message: "Proceed with connection?" });

    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel("Connection cancelled");
      process.exit(0);
    }
  }

  // ── Step 6: Write configs ──

  spin.start("Configuring agents...");

  const results: ConnectResult[] = [];
  const connectOptions: ConnectOptions = { mode, serverUrl, apiKey };

  if (mode === "hosted") {
    const health = await verifyServer(serverUrl);
    if (!health.ok) {
      p.log.warn("Server unreachable — config will be written anyway");
    }
  }

  for (const agentName of targetAgents) {
    const agent = agents[agentName];

    // Check mode compatibility — silently downgrade if needed
    if (!agent.supportedModes.includes(mode)) {
      if (mode === "hosted" && agent.supportedModes.includes("local")) {
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

  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;

  if (failCount === 0) {
    spin.stop(`${pc.green(String(successCount))} agent${successCount !== 1 ? "s" : ""} configured`);
  } else {
    spin.stop(`${successCount} configured, ${failCount} failed`);
  }

  // ── Step 7: Results ──

  const resultLines: string[] = [];

  for (const r of results) {
    if (r.success) {
      resultLines.push(`${pc.green("✓")} ${r.agent} ${pc.dim(`(${r.mode})`)}`);
      resultLines.push(`  ${pc.dim(r.path)}`);
      if (r.postConfigureResult === "ok") {
        resultLines.push(`  ${pc.dim("+ /nella slash command installed")}`);
      }
    } else {
      resultLines.push(`${pc.red("✗")} ${r.agent}: ${pc.dim(r.error || "unknown error")}`);
      resultLines.push(`  ${pc.dim(r.path)}`);
    }
  }

  p.note(
    resultLines.join("\n"),
    failCount === 0
      ? pc.green(`Connected ${successCount} agent${successCount !== 1 ? "s" : ""}`)
      : `${successCount} connected, ${failCount} failed`,
  );

  if (failCount > 0) {
    p.log.warn("Some agents failed to configure. Check paths above.");
  }

  p.outro(
    pc.green("Done!") +
    pc.dim("  Restart your agents to connect to Nella.")
  );
}
