import * as fs from "fs";
import * as path from "path";
import type { AgentConfig, ConnectMode, ConnectOptions, ConnectResult } from "./types";

interface HostedEntry {
  url: string;
  headers: { Authorization: string };
}

interface LocalEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export function buildHostedEntry(serverUrl: string, apiKey: string): HostedEntry {
  return {
    url: serverUrl,
    headers: { Authorization: `Bearer ${apiKey}` },
  };
}

export function buildLocalEntry(): LocalEntry {
  return {
    command: "npx",
    args: ["-y", "@getnella/mcp"],
  };
}

function readJsonSafe(filePath: string): Record<string, unknown> {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch {}
  return {};
}

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function writeAgentConfig(agent: AgentConfig, options: ConnectOptions): ConnectResult {
  const configPath = agent.getConfigPath();
  const mode = options.mode;

  try {
    ensureDir(configPath);
    const config = readJsonSafe(configPath);

    const entry = mode === "hosted"
      ? buildHostedEntry(options.serverUrl!, options.apiKey!)
      : buildLocalEntry();

    const servers = (config[agent.configKey] as Record<string, unknown>) || {};
    servers.nella = entry;
    config[agent.configKey] = servers;

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");

    let postConfigureResult: string | undefined;
    if (agent.postConfigure) {
      try {
        agent.postConfigure(mode);
        postConfigureResult = "ok";
      } catch (err) {
        postConfigureResult = err instanceof Error ? err.message : String(err);
      }
    }

    return { agent: agent.displayName, success: true, path: configPath, mode, postConfigureResult };
  } catch (err) {
    return {
      agent: agent.displayName,
      success: false,
      path: configPath,
      mode,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
