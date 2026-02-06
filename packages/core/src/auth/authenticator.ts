/**
 * Authenticator
 *
 * Central authentication service combining key and agent management.
 * Handles auth requests, permission checks, and rate limiting coordination.
 */

import type {
  ApiKey,
  Agent,
  AuthRequest,
  AuthResult,
  AuthAction,
  AuthEvent,
  ApiKeyPermissions,
  ExtendedAuthEvent,
} from "./types";
import { KeyManager, KeyManagerOptions } from "./key-manager";
import { AgentManager } from "./agent-manager";

// =============================================================================
// Types
// =============================================================================

export interface AuthenticatorOptions {
  storagePath: string;
  encryptionKey?: string;
  onEvent?: (event: ExtendedAuthEvent) => void;
}

// Action to permission mapping
const ACTION_PERMISSIONS: Record<AuthAction, keyof ApiKeyPermissions> = {
  search: "search",
  verify: "verify",
  index: "index",
  read_context: "readContext",
  write_context: "writeContext",
  manage_sessions: "manageSessions",
  admin: "admin",
};

// =============================================================================
// Authenticator Class
// =============================================================================

export class Authenticator {
  private keyManager!: KeyManager;
  private agentManager!: AgentManager;
  private onEventHandler?: (event: ExtendedAuthEvent) => void;

  private constructor(private options: AuthenticatorOptions) {
    this.onEventHandler = options.onEvent;
  }

  /**
   * Create and initialize an Authenticator instance
   */
  static async create(options: AuthenticatorOptions): Promise<Authenticator> {
    const auth = new Authenticator(options);
    await auth.init();
    return auth;
  }

  /**
   * Async initialization — creates KeyManager and AgentManager
   */
  private async init(): Promise<void> {
    const keyManagerOptions: KeyManagerOptions = {
      storagePath: this.options.storagePath,
      encryptionKey: this.options.encryptionKey,
    };
    this.keyManager = await KeyManager.create(keyManagerOptions);
    this.agentManager = await AgentManager.create(this.options.storagePath);

    // Forward events
    this.keyManager.onEvent((event) => this.emit(event));
    this.agentManager.onEvent((event) => this.emit(event as ExtendedAuthEvent));
  }

  private emit(event: ExtendedAuthEvent): void {
    this.onEventHandler?.(event);
  }

  // =============================================================================
  // Authentication
  // =============================================================================

  /**
   * Authenticate a request
   */
  async authenticate(request: AuthRequest): Promise<AuthResult> {
    // Validate key
    const key = await this.keyManager.validate(request.apiKey);
    if (!key) {
      this.emit({ type: "auth:failure", error: "INVALID_KEY" });
      return {
        success: false,
        error: "Invalid API key",
        errorCode: "INVALID_KEY",
      };
    }

    // Check if key is expired
    if (this.keyManager.isExpired(key)) {
      this.emit({ type: "auth:failure", error: "EXPIRED_KEY", keyPrefix: key.prefix });
      return {
        success: false,
        error: "API key has expired",
        errorCode: "EXPIRED_KEY",
      };
    }

    // Check if key is revoked
    if (!key.active) {
      this.emit({ type: "auth:failure", error: "REVOKED_KEY", keyPrefix: key.prefix });
      return {
        success: false,
        error: "API key has been revoked",
        errorCode: "REVOKED_KEY",
      };
    }

    // Check permission for action
    const requiredPermission = ACTION_PERMISSIONS[request.action];
    if (!this.keyManager.hasPermission(key, requiredPermission)) {
      this.emit({ type: "auth:failure", error: "INSUFFICIENT_PERMISSIONS", keyPrefix: key.prefix });
      return {
        success: false,
        error: `Insufficient permissions for action: ${request.action}`,
        errorCode: "INSUFFICIENT_PERMISSIONS",
      };
    }

    // Get associated agent if key is agent-scoped
    let agent: Agent | undefined;
    if (key.agentId) {
      agent = this.agentManager.get(key.agentId) || undefined;
      if (agent && !agent.active) {
        this.emit({ type: "auth:failure", error: "AGENT_INACTIVE", keyPrefix: key.prefix });
        return {
          success: false,
          error: "Agent is inactive",
          errorCode: "AGENT_INACTIVE",
        };
      }
    }

    // Record key usage
    this.emit({ type: "key:used", keyId: key.id, action: request.action });
    this.emit({ type: "auth:success", keyId: key.id, action: request.action });

    // Record agent activity
    if (agent) {
      await this.agentManager.recordActivity(agent.id);
    }

    return {
      success: true,
      key,
      agent,
    };
  }

  /**
   * Quick check if key is valid (no permission check)
   */
  async isValidKey(apiKey: string): Promise<boolean> {
    const key = await this.keyManager.validate(apiKey);
    return key !== null && key.active && !this.keyManager.isExpired(key);
  }

  /**
   * Check if agent can access file
   */
  async canAccessFile(apiKey: string, filePath: string): Promise<boolean> {
    const key = await this.keyManager.validate(apiKey);
    if (!key?.agentId) return true; // No agent restriction

    return this.agentManager.canAccessFile(key.agentId, filePath);
  }

  // =============================================================================
  // Key Management (Delegated)
  // =============================================================================

  get keys(): KeyManager {
    return this.keyManager;
  }

  // =============================================================================
  // Agent Management (Delegated)
  // =============================================================================

  get agents(): AgentManager {
    return this.agentManager;
  }

  // =============================================================================
  // Convenience Methods
  // =============================================================================

  /**
   * Setup a workspace with agent and keys
   */
  async setupWorkspace(
    workspaceId: string,
    options?: {
      agentType?: Agent["type"];
      agentName?: string;
      createAdminKey?: boolean;
    }
  ): Promise<{
    agent: Agent;
    agentKey: { key: ApiKey; rawKey: string };
    adminKey?: { key: ApiKey; rawKey: string };
  }> {
    // Create agent
    const agentType = options?.agentType || "custom";
    let agent: Agent;

    switch (agentType) {
      case "copilot":
        agent = await this.agentManager.createCopilot(workspaceId, options?.agentName);
        break;
      case "cursor":
        agent = await this.agentManager.createCursor(workspaceId, options?.agentName);
        break;
      case "cline":
        agent = await this.agentManager.createCline(workspaceId, options?.agentName);
        break;
      default:
        agent = await this.agentManager.create({
          name: options?.agentName || "Default Agent",
          type: agentType,
          workspaceId,
        });
    }

    // Create agent key
    const agentKey = await this.keyManager.createForAgent(
      workspaceId,
      agent.id,
      `${agent.name} Key`,
      agent.config.defaultPermissions,
      agent.config.rateLimit
    );

    // Create admin key if requested
    let adminKey: { key: ApiKey; rawKey: string } | undefined;
    if (options?.createAdminKey) {
      adminKey = await this.keyManager.createAdmin(`${workspaceId} Admin`);
    }

    return { agent, agentKey, adminKey };
  }

  /**
   * Get workspace summary
   */
  getWorkspaceSummary(workspaceId: string): {
    agents: Agent[];
    keys: ApiKey[];
    totalRequests: number;
    totalTokens: number;
  } {
    const agents = this.agentManager.list({ workspaceId });
    const keys = this.keyManager.list({ workspaceId });

    const totalRequests = agents.reduce((sum, a) => sum + a.metadata.totalRequests, 0);
    const totalTokens = agents.reduce((sum, a) => sum + a.metadata.totalTokens, 0);

    return { agents, keys, totalRequests, totalTokens };
  }
}

// =============================================================================
// Factory
// =============================================================================

export async function createAuthenticator(
  storagePath: string,
  onEvent?: (event: ExtendedAuthEvent) => void,
  encryptionKey?: string
): Promise<Authenticator> {
  return Authenticator.create({ storagePath, onEvent, encryptionKey });
}
