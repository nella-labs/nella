/**
 * Agent Manager
 *
 * Register and manage agents with their configurations.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import type {
  Agent,
  AgentType,
  AgentConfig,
  ApiKeyPermissions,
  RateLimitConfig,
  AuthEvent,
  DEFAULT_PERMISSIONS,
  DEFAULT_RATE_LIMIT,
} from "./types";

// =============================================================================
// Types
// =============================================================================

export interface CreateAgentOptions {
  name: string;
  type: AgentType;
  workspaceId: string;
  permissions?: Partial<ApiKeyPermissions>;
  rateLimit?: Partial<RateLimitConfig>;
  allowedPatterns?: string[];
  blockedPatterns?: string[];
  settings?: Record<string, unknown>;
}

export type AgentEventHandler = (event: AuthEvent) => void;

interface AgentStore {
  agents: Agent[];
  version: string;
  updatedAt: string;
}

// =============================================================================
// Agent Manager Class
// =============================================================================

export class AgentManager {
  private store: AgentStore;
  private storePath: string;
  private eventHandlers: AgentEventHandler[] = [];

  constructor(storagePath: string) {
    this.storePath = path.join(storagePath, "agents.json");
    
    // Ensure directory exists
    const dir = path.dirname(this.storePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.store = this.loadStore();
  }

  // =============================================================================
  // Event Handling
  // =============================================================================

  onEvent(handler: AgentEventHandler): void {
    this.eventHandlers.push(handler);
  }

  private emit(event: AuthEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error("Agent event handler error:", error);
      }
    }
  }

  // =============================================================================
  // Agent Creation
  // =============================================================================

  /**
   * Register a new agent
   */
  create(options: CreateAgentOptions): Agent {
    // Generate agent ID
    const id = `agent_${crypto.randomBytes(8).toString("hex")}`;

    // Build config
    const config: AgentConfig = {
      defaultPermissions: {
        ...this.getDefaultPermissions(),
        ...options.permissions,
      },
      rateLimit: {
        ...this.getDefaultRateLimit(),
        ...options.rateLimit,
      },
      allowedPatterns: options.allowedPatterns || ["**/*"],
      blockedPatterns: options.blockedPatterns || [
        "**/node_modules/**",
        "**/.git/**",
        "**/.env*",
        "**/secrets/**",
      ],
      settings: options.settings || {},
    };

    const agent: Agent = {
      id,
      name: options.name,
      type: options.type,
      workspaceId: options.workspaceId,
      config,
      metadata: {
        createdAt: new Date().toISOString(),
        lastActive: null,
        totalRequests: 0,
        totalTokens: 0,
      },
      active: true,
    };

    this.store.agents.push(agent);
    this.save();

    this.emit({ type: "agent:created", agent });

    return agent;
  }

  /**
   * Create pre-configured agents for common types
   */
  createCopilot(workspaceId: string, name?: string): Agent {
    return this.create({
      name: name || "GitHub Copilot",
      type: "copilot",
      workspaceId,
      permissions: {
        search: true,
        verify: true,
        index: false,
        readContext: true,
        writeContext: false,
      },
      rateLimit: {
        requestsPerMinute: 120,
        requestsPerHour: 2000,
        requestsPerDay: 20000,
        maxTokensPerRequest: 150000,
        maxConcurrent: 10,
      },
    });
  }

  createCursor(workspaceId: string, name?: string): Agent {
    return this.create({
      name: name || "Cursor",
      type: "cursor",
      workspaceId,
      permissions: {
        search: true,
        verify: true,
        index: true,
        readContext: true,
        writeContext: true,
      },
      rateLimit: {
        requestsPerMinute: 100,
        requestsPerHour: 1500,
        requestsPerDay: 15000,
        maxTokensPerRequest: 200000,
        maxConcurrent: 8,
      },
    });
  }

  createCline(workspaceId: string, name?: string): Agent {
    return this.create({
      name: name || "Cline",
      type: "cline",
      workspaceId,
      permissions: {
        search: true,
        verify: true,
        index: true,
        readContext: true,
        writeContext: true,
        manageSessions: true,
      },
      rateLimit: {
        requestsPerMinute: 80,
        requestsPerHour: 1200,
        requestsPerDay: 12000,
        maxTokensPerRequest: 250000,
        maxConcurrent: 5,
      },
    });
  }

  // =============================================================================
  // Agent Management
  // =============================================================================

  /**
   * Get agent by ID
   */
  get(agentId: string): Agent | null {
    return this.store.agents.find((a) => a.id === agentId) || null;
  }

  /**
   * Get agent by name in workspace
   */
  getByName(workspaceId: string, name: string): Agent | null {
    return this.store.agents.find(
      (a) => a.workspaceId === workspaceId && a.name === name
    ) || null;
  }

  /**
   * List agents
   */
  list(options?: {
    workspaceId?: string;
    type?: AgentType;
    activeOnly?: boolean;
  }): Agent[] {
    let agents = [...this.store.agents];

    if (options?.workspaceId) {
      agents = agents.filter((a) => a.workspaceId === options.workspaceId);
    }

    if (options?.type) {
      agents = agents.filter((a) => a.type === options.type);
    }

    if (options?.activeOnly !== false) {
      agents = agents.filter((a) => a.active);
    }

    return agents;
  }

  /**
   * Update agent
   */
  update(agentId: string, updates: {
    name?: string;
    config?: Partial<AgentConfig>;
    active?: boolean;
  }): Agent | null {
    const agent = this.get(agentId);
    if (!agent) return null;

    if (updates.name) agent.name = updates.name;
    if (updates.active !== undefined) agent.active = updates.active;
    if (updates.config) {
      agent.config = {
        ...agent.config,
        ...updates.config,
        defaultPermissions: {
          ...agent.config.defaultPermissions,
          ...updates.config.defaultPermissions,
        },
        rateLimit: {
          ...agent.config.rateLimit,
          ...updates.config.rateLimit,
        },
      };
    }

    this.save();

    this.emit({ type: "agent:updated", agent });

    return agent;
  }

  /**
   * Update agent rate limit
   */
  updateRateLimit(agentId: string, rateLimit: Partial<RateLimitConfig>): Agent | null {
    const agent = this.get(agentId);
    if (!agent) return null;

    agent.config.rateLimit = {
      ...agent.config.rateLimit,
      ...rateLimit,
    };

    this.save();

    this.emit({ type: "agent:updated", agent });

    return agent;
  }

  /**
   * Update agent permissions
   */
  updatePermissions(agentId: string, permissions: Partial<ApiKeyPermissions>): Agent | null {
    const agent = this.get(agentId);
    if (!agent) return null;

    agent.config.defaultPermissions = {
      ...agent.config.defaultPermissions,
      ...permissions,
    };

    this.save();

    this.emit({ type: "agent:updated", agent });

    return agent;
  }

  /**
   * Deactivate agent
   */
  deactivate(agentId: string): boolean {
    const agent = this.get(agentId);
    if (!agent) return false;

    agent.active = false;
    this.save();

    this.emit({ type: "agent:deactivated", agentId });

    return true;
  }

  /**
   * Activate agent
   */
  activate(agentId: string): boolean {
    const agent = this.get(agentId);
    if (!agent) return false;

    agent.active = true;
    this.save();

    this.emit({ type: "agent:updated", agent });

    return true;
  }

  /**
   * Delete agent
   */
  delete(agentId: string): boolean {
    const index = this.store.agents.findIndex((a) => a.id === agentId);
    if (index === -1) return false;

    this.store.agents.splice(index, 1);
    this.save();

    return true;
  }

  /**
   * Record agent activity
   */
  recordActivity(agentId: string, tokens: number = 0): void {
    const agent = this.get(agentId);
    if (!agent) return;

    agent.metadata.lastActive = new Date().toISOString();
    agent.metadata.totalRequests++;
    agent.metadata.totalTokens += tokens;

    this.save();
  }

  // =============================================================================
  // File Access Control
  // =============================================================================

  /**
   * Check if agent can access a file
   */
  canAccessFile(agentId: string, filePath: string): boolean {
    const agent = this.get(agentId);
    if (!agent || !agent.active) return false;

    const normalizedPath = filePath.replace(/\\/g, "/");

    // Check blocked patterns first
    for (const pattern of agent.config.blockedPatterns) {
      if (this.matchPattern(normalizedPath, pattern)) {
        return false;
      }
    }

    // Check allowed patterns
    for (const pattern of agent.config.allowedPatterns) {
      if (this.matchPattern(normalizedPath, pattern)) {
        return true;
      }
    }

    return false;
  }

  private matchPattern(filePath: string, pattern: string): boolean {
    // Simple glob matching
    const regexPattern = pattern
      .replace(/\*\*/g, "§")
      .replace(/\*/g, "[^/]*")
      .replace(/§/g, ".*")
      .replace(/\?/g, ".");
    
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(filePath);
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  private loadStore(): AgentStore {
    if (fs.existsSync(this.storePath)) {
      try {
        const content = fs.readFileSync(this.storePath, "utf-8");
        return JSON.parse(content) as AgentStore;
      } catch {
        // Corrupted file, start fresh
      }
    }

    return {
      agents: [],
      version: "1.0.0",
      updatedAt: new Date().toISOString(),
    };
  }

  private save(): void {
    this.store.updatedAt = new Date().toISOString();
    fs.writeFileSync(this.storePath, JSON.stringify(this.store, null, 2));
  }

  private getDefaultPermissions(): ApiKeyPermissions {
    return {
      search: true,
      verify: true,
      index: false,
      readContext: true,
      writeContext: false,
      manageSessions: false,
      admin: false,
    };
  }

  private getDefaultRateLimit(): RateLimitConfig {
    return {
      requestsPerMinute: 60,
      requestsPerHour: 1000,
      requestsPerDay: 10000,
      maxTokensPerRequest: 100000,
      maxConcurrent: 5,
    };
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createAgentManager(storagePath: string): AgentManager {
  return new AgentManager(storagePath);
}
