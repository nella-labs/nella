import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { AgentType, AgentConfig, ConnectMode } from "./types";

const home = os.homedir();
const platform = process.platform;

function getClaudeDesktopConfigPath(): string {
  if (platform === "win32") {
    return path.join(process.env.APPDATA || "", "Claude", "claude_desktop_config.json");
  } else if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  return path.join(home, ".config", "claude", "claude_desktop_config.json");
}

function getClaudeCodeConfigPath(): string {
  const claudeHome = process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(home, ".claude");
  return path.join(claudeHome, "settings.json");
}

function getVsCodeConfigPath(): string {
  return path.join(process.cwd(), ".vscode", "mcp.json");
}

function getCursorConfigPath(): string {
  return path.join(home, ".cursor", "mcp.json");
}

function getWindsurfConfigPath(): string {
  return path.join(home, ".codeium", "windsurf", "mcp_config.json");
}

function getVsCodeGlobalStoragePath(): string {
  if (platform === "win32") {
    return path.join(process.env.APPDATA || "", "Code", "User", "globalStorage");
  } else if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Code", "User", "globalStorage");
  }
  return path.join(home, ".config", "Code", "User", "globalStorage");
}

function getClineConfigPath(): string {
  const storage = getVsCodeGlobalStoragePath();
  return path.join(storage, "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json");
}

function getRooCodeConfigPath(): string {
  const storage = getVsCodeGlobalStoragePath();
  return path.join(storage, "rooveterinaryinc.roo-cline", "settings", "cline_mcp_settings.json");
}

function claudeCodePostConfigure(_mode: ConnectMode): void {
  const claudeHome = process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(home, ".claude");
  const commandSrc = path.join(__dirname, "..", "claude-plugin", "commands", "nella.md");
  const commandsDir = path.join(claudeHome, "commands");
  const commandDest = path.join(commandsDir, "nella.md");

  if (!fs.existsSync(commandSrc)) return;

  fs.mkdirSync(commandsDir, { recursive: true });
  fs.copyFileSync(commandSrc, commandDest);

  // Clean up legacy marketplace plugin (pre-v0.1.6)
  const legacyMarketplace = path.join(claudeHome, "plugins", "marketplaces", "nella");
  if (fs.existsSync(legacyMarketplace)) {
    fs.rmSync(legacyMarketplace, { recursive: true, force: true });
  }
  const legacyDest = path.join(claudeHome, "plugins", "nella");
  if (fs.existsSync(legacyDest) && fs.statSync(legacyDest).isDirectory()) {
    fs.rmSync(legacyDest, { recursive: true, force: true });
  }
  const knownMarketplacesPath = path.join(claudeHome, "plugins", "known_marketplaces.json");
  try {
    const km = JSON.parse(fs.readFileSync(knownMarketplacesPath, "utf-8"));
    if (km["nella"]) {
      delete km["nella"];
      fs.writeFileSync(knownMarketplacesPath, JSON.stringify(km, null, 2) + "\n");
    }
  } catch {}
}

export const agents: Record<AgentType, AgentConfig> = {
  "claude-desktop": {
    name: "claude-desktop",
    displayName: "Claude Desktop",
    getConfigPath: getClaudeDesktopConfigPath,
    configKey: "mcpServers",
    supportedModes: ["hosted", "local"],
    detectInstalled: () => {
      const configPath = getClaudeDesktopConfigPath();
      if (fs.existsSync(path.dirname(configPath))) return true;
      if (platform === "darwin") {
        return fs.existsSync("/Applications/Claude.app");
      }
      return false;
    },
  },
  "claude-code": {
    name: "claude-code",
    displayName: "Claude Code",
    getConfigPath: getClaudeCodeConfigPath,
    configKey: "mcpServers",
    supportedModes: ["local"],
    detectInstalled: () => {
      const claudeHome = process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(home, ".claude");
      return fs.existsSync(claudeHome);
    },
    postConfigure: claudeCodePostConfigure,
  },
  vscode: {
    name: "vscode",
    displayName: "VS Code",
    getConfigPath: getVsCodeConfigPath,
    configKey: "servers",
    supportedModes: ["hosted", "local"],
    detectInstalled: () => {
      if (platform === "darwin") {
        return fs.existsSync("/Applications/Visual Studio Code.app") || fs.existsSync(path.join(home, ".vscode"));
      }
      return fs.existsSync(path.join(home, ".vscode"));
    },
  },
  cursor: {
    name: "cursor",
    displayName: "Cursor",
    getConfigPath: getCursorConfigPath,
    configKey: "mcpServers",
    supportedModes: ["hosted", "local"],
    detectInstalled: () => {
      return fs.existsSync(path.join(home, ".cursor"));
    },
  },
  windsurf: {
    name: "windsurf",
    displayName: "Windsurf",
    getConfigPath: getWindsurfConfigPath,
    configKey: "mcpServers",
    supportedModes: ["hosted", "local"],
    detectInstalled: () => {
      return fs.existsSync(path.join(home, ".codeium", "windsurf"));
    },
  },
  cline: {
    name: "cline",
    displayName: "Cline",
    getConfigPath: getClineConfigPath,
    configKey: "mcpServers",
    supportedModes: ["hosted", "local"],
    detectInstalled: () => {
      const storage = getVsCodeGlobalStoragePath();
      return fs.existsSync(path.join(storage, "saoudrizwan.claude-dev"));
    },
  },
  "roo-code": {
    name: "roo-code",
    displayName: "Roo Code",
    getConfigPath: getRooCodeConfigPath,
    configKey: "mcpServers",
    supportedModes: ["hosted", "local"],
    detectInstalled: () => {
      const storage = getVsCodeGlobalStoragePath();
      return fs.existsSync(path.join(storage, "rooveterinaryinc.roo-cline"));
    },
  },
};

export function detectInstalledAgents(): AgentType[] {
  return (Object.keys(agents) as AgentType[]).filter((key) => agents[key].detectInstalled());
}

export function getAgent(name: string): AgentConfig | undefined {
  return agents[name as AgentType];
}

export function getAllAgentNames(): AgentType[] {
  return Object.keys(agents) as AgentType[];
}
