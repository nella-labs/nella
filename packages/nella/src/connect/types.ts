export type AgentType =
  | "claude-desktop"
  | "claude-code"
  | "vscode"
  | "cursor"
  | "windsurf"
  | "cline"
  | "roo-code";

export type ConnectMode = "hosted" | "local";

export interface AgentConfig {
  name: AgentType;
  displayName: string;
  getConfigPath: () => string;
  /** JSON key for MCP server entries ("mcpServers" | "servers") */
  configKey: string;
  supportedModes: ConnectMode[];
  detectInstalled: () => boolean;
  /** Optional hook run after config is written (e.g., install slash command) */
  postConfigure?: (mode: ConnectMode) => void;
}

export interface ConnectOptions {
  mode: ConnectMode;
  serverUrl?: string;
  apiKey?: string;
}

export interface ConnectResult {
  agent: string;
  success: boolean;
  path: string;
  mode: ConnectMode;
  error?: string;
  postConfigureResult?: string;
}
