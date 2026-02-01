/**
 * API Key Manager
 *
 * Secure API key generation, storage, and validation.
 * Keys are stored with bcrypt-style hashing.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import type {
  ApiKey,
  ApiKeyPermissions,
  RateLimitConfig,
  KeyStore,
  KeyStoreSettings,
  AuthEvent,
  DEFAULT_PERMISSIONS,
  DEFAULT_RATE_LIMIT,
  DEFAULT_KEY_STORE_SETTINGS,
} from "./types";

// =============================================================================
// Types
// =============================================================================

export interface CreateKeyOptions {
  name: string;
  workspaceId?: string | null;
  agentId?: string | null;
  permissions?: Partial<ApiKeyPermissions>;
  rateLimit?: Partial<RateLimitConfig>;
  expiresInDays?: number;
  createdBy?: string;
}

export type AuthEventHandler = (event: AuthEvent) => void;

// =============================================================================
// Key Manager Class
// =============================================================================

export class KeyManager {
  private store: KeyStore;
  private storePath: string;
  private eventHandlers: AuthEventHandler[] = [];

  constructor(storagePath: string) {
    this.storePath = path.join(storagePath, "keys.json");
    
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

  onEvent(handler: AuthEventHandler): void {
    this.eventHandlers.push(handler);
  }

  private emit(event: AuthEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error("Auth event handler error:", error);
      }
    }
  }

  // =============================================================================
  // Key Creation
  // =============================================================================

  /**
   * Create a new API key
   * Returns the raw key value (only returned once!)
   */
  create(options: CreateKeyOptions): { key: ApiKey; rawKey: string } {
    // Generate key
    const rawKey = this.generateKey();
    const keyHash = this.hashKey(rawKey);
    const prefix = rawKey.slice(0, 8);

    // Generate key ID
    const id = `key_${crypto.randomBytes(8).toString("hex")}`;

    // Merge permissions
    const permissions: ApiKeyPermissions = {
      ...this.getDefaultPermissions(),
      ...options.permissions,
    };

    // Merge rate limit
    const rateLimit = options.rateLimit ? {
      ...this.getDefaultRateLimit(),
      ...options.rateLimit,
    } : null;

    // Calculate expiry
    let expiresAt: string | null = null;
    if (options.expiresInDays && options.expiresInDays > 0) {
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + options.expiresInDays);
      expiresAt = expiry.toISOString();
    } else if (this.store.settings.keyExpiryDays > 0) {
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + this.store.settings.keyExpiryDays);
      expiresAt = expiry.toISOString();
    }

    const key: ApiKey = {
      id,
      name: options.name,
      keyHash,
      prefix,
      workspaceId: options.workspaceId ?? null,
      agentId: options.agentId ?? null,
      permissions,
      rateLimit,
      metadata: {
        createdAt: new Date().toISOString(),
        createdBy: options.createdBy || "system",
        lastUsed: null,
        expiresAt,
        usageCount: 0,
      },
      active: true,
    };

    this.store.keys.push(key);
    this.save();

    this.emit({ type: "key:created", key, rawKey });

    return { key, rawKey };
  }

  /**
   * Create admin key
   */
  createAdmin(name: string, createdBy?: string): { key: ApiKey; rawKey: string } {
    return this.create({
      name,
      createdBy,
      permissions: {
        search: true,
        verify: true,
        index: true,
        readContext: true,
        writeContext: true,
        manageSessions: true,
        admin: true,
      },
      expiresInDays: 0, // Admin keys don't expire
    });
  }

  /**
   * Create workspace-scoped key
   */
  createForWorkspace(
    workspaceId: string,
    name: string,
    permissions?: Partial<ApiKeyPermissions>
  ): { key: ApiKey; rawKey: string } {
    return this.create({
      name,
      workspaceId,
      permissions,
    });
  }

  /**
   * Create agent-scoped key
   */
  createForAgent(
    workspaceId: string,
    agentId: string,
    name: string,
    permissions?: Partial<ApiKeyPermissions>,
    rateLimit?: Partial<RateLimitConfig>
  ): { key: ApiKey; rawKey: string } {
    return this.create({
      name,
      workspaceId,
      agentId,
      permissions,
      rateLimit,
    });
  }

  // =============================================================================
  // Key Validation
  // =============================================================================

  /**
   * Validate a raw API key
   * Returns the key if valid, null otherwise
   */
  validate(rawKey: string): ApiKey | null {
    // Find by prefix first (fast lookup)
    const prefix = rawKey.slice(0, 8);
    const candidates = this.store.keys.filter((k) => k.prefix === prefix && k.active);

    for (const key of candidates) {
      if (this.verifyKey(rawKey, key.keyHash)) {
        // Update usage
        key.metadata.lastUsed = new Date().toISOString();
        key.metadata.usageCount++;
        this.save();

        return key;
      }
    }

    return null;
  }

  /**
   * Check if key is expired
   */
  isExpired(key: ApiKey): boolean {
    if (!key.metadata.expiresAt) return false;
    return new Date(key.metadata.expiresAt) < new Date();
  }

  /**
   * Check if key has permission
   */
  hasPermission(key: ApiKey, permission: keyof ApiKeyPermissions): boolean {
    // Admin has all permissions
    if (key.permissions.admin) return true;
    return key.permissions[permission] === true;
  }

  // =============================================================================
  // Key Management
  // =============================================================================

  /**
   * Get key by ID
   */
  get(keyId: string): ApiKey | null {
    return this.store.keys.find((k) => k.id === keyId) || null;
  }

  /**
   * List all keys
   */
  list(options?: {
    workspaceId?: string;
    agentId?: string;
    activeOnly?: boolean;
  }): ApiKey[] {
    let keys = [...this.store.keys];

    if (options?.workspaceId) {
      keys = keys.filter((k) => k.workspaceId === options.workspaceId);
    }

    if (options?.agentId) {
      keys = keys.filter((k) => k.agentId === options.agentId);
    }

    if (options?.activeOnly !== false) {
      keys = keys.filter((k) => k.active && !this.isExpired(k));
    }

    return keys;
  }

  /**
   * Revoke a key
   */
  revoke(keyId: string, reason: string, revokedBy?: string): boolean {
    const key = this.get(keyId);
    if (!key) return false;

    key.active = false;
    key.revocation = {
      revokedAt: new Date().toISOString(),
      revokedBy: revokedBy || "system",
      reason,
    };

    this.save();

    this.emit({ type: "key:revoked", keyId, reason });

    return true;
  }

  /**
   * Update key permissions
   */
  updatePermissions(keyId: string, permissions: Partial<ApiKeyPermissions>): ApiKey | null {
    const key = this.get(keyId);
    if (!key) return null;

    key.permissions = { ...key.permissions, ...permissions };
    this.save();

    return key;
  }

  /**
   * Update key rate limit
   */
  updateRateLimit(keyId: string, rateLimit: Partial<RateLimitConfig>): ApiKey | null {
    const key = this.get(keyId);
    if (!key) return null;

    key.rateLimit = {
      ...(key.rateLimit || this.getDefaultRateLimit()),
      ...rateLimit,
    };
    this.save();

    return key;
  }

  /**
   * Rotate key (create new, revoke old)
   */
  rotate(keyId: string): { key: ApiKey; rawKey: string } | null {
    const oldKey = this.get(keyId);
    if (!oldKey) return null;

    // Create new key with same settings
    const result = this.create({
      name: oldKey.name,
      workspaceId: oldKey.workspaceId,
      agentId: oldKey.agentId,
      permissions: oldKey.permissions,
      rateLimit: oldKey.rateLimit || undefined,
    });

    // Revoke old key
    this.revoke(keyId, "Rotated", "system");

    return result;
  }

  /**
   * Delete key permanently
   */
  delete(keyId: string): boolean {
    const index = this.store.keys.findIndex((k) => k.id === keyId);
    if (index === -1) return false;

    this.store.keys.splice(index, 1);
    this.save();

    return true;
  }

  // =============================================================================
  // Settings
  // =============================================================================

  getSettings(): KeyStoreSettings {
    return { ...this.store.settings };
  }

  updateSettings(settings: Partial<KeyStoreSettings>): void {
    this.store.settings = { ...this.store.settings, ...settings };
    this.save();
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  private loadStore(): KeyStore {
    if (fs.existsSync(this.storePath)) {
      try {
        const content = fs.readFileSync(this.storePath, "utf-8");
        const store = JSON.parse(content) as KeyStore;
        
        // Ensure settings have defaults
        store.settings = {
          ...this.getDefaultSettings(),
          ...store.settings,
        };

        return store;
      } catch {
        // Corrupted file, start fresh
      }
    }

    return {
      keys: [],
      agents: [],
      settings: this.getDefaultSettings(),
      version: "1.0.0",
      updatedAt: new Date().toISOString(),
    };
  }

  private save(): void {
    this.store.updatedAt = new Date().toISOString();
    fs.writeFileSync(this.storePath, JSON.stringify(this.store, null, 2));
  }

  private getDefaultSettings(): KeyStoreSettings {
    return {
      defaultRateLimit: this.getDefaultRateLimit(),
      defaultPermissions: this.getDefaultPermissions(),
      keyExpiryDays: 90,
      logAuthRequests: true,
      encryptionEnabled: false,
    };
  }

  private getDefaultPermissions(): ApiKeyPermissions {
    return this.store?.settings?.defaultPermissions || {
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
    return this.store?.settings?.defaultRateLimit || {
      requestsPerMinute: 60,
      requestsPerHour: 1000,
      requestsPerDay: 10000,
      maxTokensPerRequest: 100000,
      maxConcurrent: 5,
    };
  }

  /**
   * Generate a secure API key
   * Format: nella_<base64-encoded-32-bytes>
   */
  private generateKey(): string {
    const bytes = crypto.randomBytes(32);
    const base64 = bytes.toString("base64url");
    return `nella_${base64}`;
  }

  /**
   * Hash a key for storage
   */
  private hashKey(rawKey: string): string {
    // Use PBKDF2 for secure hashing
    const salt = crypto.randomBytes(16);
    const hash = crypto.pbkdf2Sync(rawKey, salt, 100000, 32, "sha256");
    return `${salt.toString("hex")}:${hash.toString("hex")}`;
  }

  /**
   * Verify a key against its hash
   */
  private verifyKey(rawKey: string, storedHash: string): boolean {
    const [saltHex, hashHex] = storedHash.split(":");
    const salt = Buffer.from(saltHex, "hex");
    const storedHashBuffer = Buffer.from(hashHex, "hex");
    const computedHash = crypto.pbkdf2Sync(rawKey, salt, 100000, 32, "sha256");
    return crypto.timingSafeEqual(storedHashBuffer, computedHash);
  }

  /**
   * Cleanup expired keys
   */
  cleanupExpired(): number {
    const now = new Date();
    const toRemove = this.store.keys.filter(
      (k) => k.metadata.expiresAt && new Date(k.metadata.expiresAt) < now
    );

    for (const key of toRemove) {
      this.revoke(key.id, "Expired", "system");
    }

    return toRemove.length;
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createKeyManager(storagePath: string): KeyManager {
  return new KeyManager(storagePath);
}
