/**
 * Auth Service
 *
 * Wraps KeyManager, AgentManager, Authenticator, and AuditLogManager
 * for API key lifecycle, agent registration, and usage stats.
 */

import {
  KeyManager,
  createKeyManagerFromEnv,
  AgentManager,
  createAgentManager,
  Authenticator,
  createAuthenticator,
  AuditLogManager,
  getAuditLog,
  type AuthResult,
  type AuthAction,
  type ApiKey,
  type ApiKeyPermissions,
  type Agent,
  type CreateKeyOptions,
  type CreateAgentOptions,
} from "../auth";

// =============================================================================
// Types
// =============================================================================

export type Scope =
  | "workspaces:read"
  | "workspaces:write"
  | "search:read"
  | "validate:run"
  | "context:read"
  | "context:write"
  | "admin";

export interface AuthenticateResult {
  authenticated: boolean;
  keyId?: string;
  userId?: string;
  scopes?: Scope[];
  error?: string;
}

export interface CreateApiKeyParams {
  name: string;
  userId: string;
  scopes?: Scope[];
  rateLimits?: {
    requestsPerMinute?: number;
    requestsPerHour?: number;
    requestsPerDay?: number;
  };
  expiresInDays?: number;
}

// =============================================================================
// Service
// =============================================================================

export class AuthService {
  private keyManager: KeyManager | null = null;
  private agentManager: AgentManager | null = null;
  private authenticator: Authenticator | null = null;
  private auditLog: AuditLogManager | null = null;
  private storagePath: string;

  constructor(storagePath?: string) {
    this.storagePath = storagePath || process.env.NELLA_AUTH_STORAGE_PATH || ".nella/auth";
  }

  private async getKeyManager(): Promise<KeyManager> {
    if (!this.keyManager) {
      this.keyManager = await createKeyManagerFromEnv(this.storagePath);
    }
    return this.keyManager;
  }

  private async getAgentManager(): Promise<AgentManager> {
    if (!this.agentManager) {
      this.agentManager = await createAgentManager(this.storagePath);
    }
    return this.agentManager;
  }

  private async getAuthenticator(): Promise<Authenticator> {
    if (!this.authenticator) {
      this.authenticator = await createAuthenticator(this.storagePath);
    }
    return this.authenticator;
  }

  private async getAuditLog(): Promise<AuditLogManager> {
    if (!this.auditLog) {
      this.auditLog = await getAuditLog();
    }
    return this.auditLog;
  }

  /**
   * Authenticate an API key.
   * Returns key info + scopes if valid.
   */
  async authenticate(apiKey: string): Promise<AuthenticateResult> {
    try {
      const auth = await this.getAuthenticator();
      const result = await auth.authenticate({
        apiKey,
        action: "search" as AuthAction,
      });

      if (result.success && result.key) {
        return {
          authenticated: true,
          keyId: result.key.id,
          userId: result.key.metadata.createdBy,
          scopes: ["workspaces:read", "workspaces:write", "search:read", "validate:run", "context:read", "context:write"], // Default scopes for now
        };
      }

      return { authenticated: false, error: result.error || "Authentication failed" };
    } catch (err) {
      return { authenticated: false, error: (err as Error).message };
    }
  }

  /**
   * Create a new API key.
   */
  async createKey(params: CreateApiKeyParams): Promise<{ key: string; keyId: string }> {
    const km = await this.getKeyManager();
    const result = await km.create({
      name: params.name,
      createdBy: params.userId,
      rateLimit: params.rateLimits ? {
        requestsPerMinute: params.rateLimits.requestsPerMinute || 60,
        requestsPerHour: params.rateLimits.requestsPerHour || 1000,
        requestsPerDay: params.rateLimits.requestsPerDay || 10000,
      } : undefined,
    } as CreateKeyOptions);

    return { key: result.rawKey, keyId: result.key.id };
  }

  /**
   * List API keys for a user.
   */
  async listKeys(_userId: string): Promise<ApiKey[]> {
    const km = await this.getKeyManager();
    return km.list({ activeOnly: true });
  }

  /**
   * Revoke an API key.
   */
  async revokeKey(keyId: string): Promise<boolean> {
    const km = await this.getKeyManager();
    return km.revoke(keyId, "Revoked via API");
  }

  /**
   * Register an agent.
   */
  async registerAgent(options: CreateAgentOptions): Promise<Agent> {
    const am = await this.getAgentManager();
    return am.create(options);
  }

  /**
   * List agents.
   */
  async listAgents(): Promise<Agent[]> {
    const am = await this.getAgentManager();
    return am.list();
  }

  /**
   * Check if a scope is allowed for the given scopes list.
   */
  hasScope(userScopes: Scope[], requiredScope: Scope): boolean {
    if (userScopes.includes("admin")) return true;
    return userScopes.includes(requiredScope);
  }

  /**
   * Log an audit event.
   */
  async logAudit(category: string, action: string, userId: string, details?: Record<string, unknown>): Promise<void> {
    try {
      const audit = await this.getAuditLog();
      await audit.log({
        category: category as any,
        action,
        actor: { type: "user", id: userId },
        outcome: "success",
        details,
      });
    } catch {
      // Audit logging is best-effort
    }
  }
}
