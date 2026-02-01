/**
 * API Key Manager
 *
 * Secure API key generation, storage, and validation.
 * Keys are stored with bcrypt-style hashing.
 *
 * Features:
 * - AES-256-GCM encryption for stored keys
 * - Automatic key rotation policies
 * - Audit logging integration
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
  RotationPolicy,
  RotationEvent,
  ExtendedAuthEvent,
} from "./types";
import { DEFAULT_ROTATION_POLICY } from "./types";

// =============================================================================
// Constants
// =============================================================================

const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM standard
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32; // 256 bits

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
  rotationPolicy?: Partial<RotationPolicy>;
}

export interface KeyManagerOptions {
  storagePath: string;
  encryptionKey?: string; // Base64 encoded 32-byte key from NELLA_AUTH_ENCRYPTION_KEY
}

export type AuthEventHandler = (event: ExtendedAuthEvent) => void;

// =============================================================================
// Key Manager Class
// =============================================================================

/**
 * Extended API Key with rotation info
 */
interface ExtendedApiKey extends ApiKey {
  rotationPolicy?: RotationPolicy;
  rotationScheduledAt?: string;
  previousKeyId?: string;
}

/**
 * Extended Key Store with encryption metadata
 */
interface ExtendedKeyStore extends KeyStore {
  encryption?: {
    enabled: boolean;
    algorithm: string;
    keyId: string; // Identifier for the encryption key version
  };
  rotationSchedule?: Array<{
    keyId: string;
    scheduledAt: string;
    notifiedAt?: string;
  }>;
}

export class KeyManager {
  private store: ExtendedKeyStore;
  private storePath: string;
  private eventHandlers: AuthEventHandler[] = [];
  private encryptionKey: Buffer | null = null;
  private rotationCheckInterval: NodeJS.Timeout | null = null;

  constructor(options: KeyManagerOptions) {
    this.storePath = path.join(options.storagePath, "keys.json");
    
    // Setup encryption key if provided
    if (options.encryptionKey) {
      this.encryptionKey = Buffer.from(options.encryptionKey, "base64");
      if (this.encryptionKey.length !== KEY_LENGTH) {
        throw new Error(
          `Encryption key must be ${KEY_LENGTH} bytes. Got ${this.encryptionKey.length} bytes.`
        );
      }
    }

    // Ensure directory exists
    const dir = path.dirname(this.storePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.store = this.loadStore();

    // Start rotation checker
    this.startRotationChecker();
  }

  // =============================================================================
  // Event Handling
  // =============================================================================

  onEvent(handler: AuthEventHandler): void {
    this.eventHandlers.push(handler);
  }

  private emit(event: ExtendedAuthEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error("Auth event handler error:", error);
      }
    }
  }

  // =============================================================================
  // Encryption Methods
  // =============================================================================

  /**
   * Check if encryption is enabled
   */
  isEncryptionEnabled(): boolean {
    return this.encryptionKey !== null;
  }

  /**
   * Encrypt sensitive data
   */
  private encrypt(plaintext: string): string {
    if (!this.encryptionKey) {
      return plaintext; // Return as-is if encryption not enabled
    }

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(
      ENCRYPTION_ALGORITHM,
      this.encryptionKey,
      iv,
      { authTagLength: AUTH_TAG_LENGTH }
    );

    let encrypted = cipher.update(plaintext, "utf8", "base64");
    encrypted += cipher.final("base64");
    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:encrypted
    return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted}`;
  }

  /**
   * Decrypt sensitive data
   */
  private decrypt(ciphertext: string): string {
    if (!this.encryptionKey) {
      return ciphertext; // Return as-is if encryption not enabled
    }

    // Check if data is encrypted (contains colons from our format)
    if (!ciphertext.includes(":")) {
      return ciphertext; // Not encrypted, return as-is
    }

    const [ivBase64, authTagBase64, encrypted] = ciphertext.split(":");
    if (!ivBase64 || !authTagBase64 || !encrypted) {
      return ciphertext; // Invalid format, return as-is
    }

    const iv = Buffer.from(ivBase64, "base64");
    const authTag = Buffer.from(authTagBase64, "base64");

    const decipher = crypto.createDecipheriv(
      ENCRYPTION_ALGORITHM,
      this.encryptionKey,
      iv,
      { authTagLength: AUTH_TAG_LENGTH }
    );
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, "base64", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  }

  /**
   * Re-encrypt all keys with a new encryption key
   */
  reEncryptAll(newEncryptionKey: string): void {
    const newKey = Buffer.from(newEncryptionKey, "base64");
    if (newKey.length !== KEY_LENGTH) {
      throw new Error(`New encryption key must be ${KEY_LENGTH} bytes.`);
    }

    // Decrypt all with old key, re-encrypt with new
    for (const key of this.store.keys as ExtendedApiKey[]) {
      // Decrypt hash with old key
      const decryptedHash = this.decrypt(key.keyHash);
      
      // Temporarily switch to new key
      const oldKey = this.encryptionKey;
      this.encryptionKey = newKey;
      
      // Re-encrypt with new key
      key.keyHash = this.encrypt(decryptedHash);
      
      // Restore old key for loop
      this.encryptionKey = oldKey;
    }

    // Now permanently switch to new key
    this.encryptionKey = newKey;
    
    // Update store encryption metadata
    this.store.encryption = {
      enabled: true,
      algorithm: ENCRYPTION_ALGORITHM,
      keyId: crypto.randomBytes(8).toString("hex"),
    };

    this.save();
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

    // Encrypt hash if encryption is enabled
    const storedHash = this.encrypt(keyHash);

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

    // Setup rotation policy
    const rotationPolicy: RotationPolicy | undefined = options.rotationPolicy
      ? { ...DEFAULT_ROTATION_POLICY, ...options.rotationPolicy }
      : undefined;

    const key: ExtendedApiKey = {
      id,
      name: options.name,
      keyHash: storedHash,
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
      rotationPolicy,
    };

    // Schedule rotation if policy is enabled
    if (rotationPolicy?.enabled) {
      this.scheduleRotation(key);
    }

    this.store.keys.push(key);
    this.save();

    this.emit({ type: "key:created", key, rawKey });

    if (this.isEncryptionEnabled()) {
      this.emit({ type: "key:encrypted", keyId: id });
    }

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
      // Decrypt hash if encrypted
      const decryptedHash = this.decrypt(key.keyHash);
      
      if (this.verifyKey(rawKey, decryptedHash)) {
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
   * Rotate key (create new, optionally keep old active for overlap period)
   */
  rotate(
    keyId: string,
    reason: "scheduled" | "manual" | "compromised" = "manual"
  ): { key: ApiKey; rawKey: string; rotationEvent: RotationEvent } | null {
    const oldKey = this.get(keyId) as ExtendedApiKey | null;
    if (!oldKey) return null;

    // Determine overlap period
    const overlapHours = oldKey.rotationPolicy?.overlapHours ?? 24;
    const autoRevokeOld = oldKey.rotationPolicy?.autoRevokeOld ?? true;

    // Calculate when old key expires
    const oldKeyExpiresAt = new Date();
    if (reason === "compromised") {
      // Immediate revocation for compromised keys
      oldKeyExpiresAt.setMinutes(oldKeyExpiresAt.getMinutes() + 5);
    } else {
      oldKeyExpiresAt.setHours(oldKeyExpiresAt.getHours() + overlapHours);
    }

    // Create new key with same settings
    const result = this.create({
      name: oldKey.name,
      workspaceId: oldKey.workspaceId,
      agentId: oldKey.agentId,
      permissions: oldKey.permissions,
      rateLimit: oldKey.rateLimit || undefined,
      rotationPolicy: oldKey.rotationPolicy,
    });

    // Link new key to old key
    (result.key as ExtendedApiKey).previousKeyId = oldKey.id;

    // Create rotation event
    const rotationEvent: RotationEvent = {
      oldKeyId: oldKey.id,
      newKeyId: result.key.id,
      rotatedAt: new Date().toISOString(),
      oldKeyExpiresAt: oldKeyExpiresAt.toISOString(),
      reason,
    };

    // Handle old key based on policy
    if (autoRevokeOld) {
      if (reason === "compromised") {
        // Revoke immediately if compromised
        this.revoke(keyId, `Key compromised, replaced by ${result.key.id}`, "system");
      } else {
        // Schedule revocation after overlap period
        oldKey.metadata.expiresAt = oldKeyExpiresAt.toISOString();
        this.save();
      }
    }

    // Emit rotation event
    this.emit({ type: "key:rotated", event: rotationEvent });

    return { ...result, rotationEvent };
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

  // =============================================================================
  // Rotation Scheduling
  // =============================================================================

  /**
   * Schedule automatic rotation for a key
   */
  private scheduleRotation(key: ExtendedApiKey): void {
    if (!key.rotationPolicy?.enabled) return;

    const nextRotation = new Date();
    nextRotation.setDate(nextRotation.getDate() + key.rotationPolicy.intervalDays);

    key.rotationScheduledAt = nextRotation.toISOString();

    // Add to rotation schedule
    if (!this.store.rotationSchedule) {
      this.store.rotationSchedule = [];
    }

    this.store.rotationSchedule.push({
      keyId: key.id,
      scheduledAt: nextRotation.toISOString(),
    });

    this.emit({
      type: "key:rotation_scheduled",
      keyId: key.id,
      scheduledAt: nextRotation.toISOString(),
    });
  }

  /**
   * Get keys due for rotation
   */
  getKeysDueForRotation(): ExtendedApiKey[] {
    const now = new Date();
    return (this.store.keys as ExtendedApiKey[]).filter((key) => {
      if (!key.active || !key.rotationScheduledAt) return false;
      return new Date(key.rotationScheduledAt) <= now;
    });
  }

  /**
   * Get keys needing rotation notification
   */
  getKeysNeedingNotification(): ExtendedApiKey[] {
    const now = new Date();
    return (this.store.keys as ExtendedApiKey[]).filter((key) => {
      if (!key.active || !key.rotationPolicy?.enabled || !key.rotationScheduledAt) {
        return false;
      }

      const scheduledAt = new Date(key.rotationScheduledAt);
      const notifyAt = new Date(scheduledAt);
      notifyAt.setHours(notifyAt.getHours() - key.rotationPolicy.notifyBeforeHours);

      // Check rotation schedule for notification
      const schedule = this.store.rotationSchedule?.find((s) => s.keyId === key.id);
      if (schedule?.notifiedAt) return false; // Already notified

      return now >= notifyAt && now < scheduledAt;
    });
  }

  /**
   * Process scheduled rotations
   */
  processScheduledRotations(): RotationEvent[] {
    const events: RotationEvent[] = [];
    const dueKeys = this.getKeysDueForRotation();

    for (const key of dueKeys) {
      const result = this.rotate(key.id, "scheduled");
      if (result) {
        events.push(result.rotationEvent);
      }
    }

    return events;
  }

  /**
   * Update rotation policy for a key
   */
  updateRotationPolicy(
    keyId: string,
    policy: Partial<RotationPolicy>
  ): ExtendedApiKey | null {
    const key = this.get(keyId) as ExtendedApiKey | null;
    if (!key) return null;

    key.rotationPolicy = {
      ...DEFAULT_ROTATION_POLICY,
      ...key.rotationPolicy,
      ...policy,
    };

    // Reschedule if policy changed
    if (policy.enabled !== undefined || policy.intervalDays !== undefined) {
      // Remove old schedule
      if (this.store.rotationSchedule) {
        this.store.rotationSchedule = this.store.rotationSchedule.filter(
          (s) => s.keyId !== keyId
        );
      }

      // Add new schedule if enabled
      if (key.rotationPolicy.enabled) {
        this.scheduleRotation(key);
      } else {
        key.rotationScheduledAt = undefined;
      }
    }

    this.save();
    return key;
  }

  /**
   * Start background rotation checker
   */
  private startRotationChecker(): void {
    // Check every hour
    this.rotationCheckInterval = setInterval(() => {
      this.processScheduledRotations();
    }, 60 * 60 * 1000);
  }

  /**
   * Stop rotation checker
   */
  stopRotationChecker(): void {
    if (this.rotationCheckInterval) {
      clearInterval(this.rotationCheckInterval);
      this.rotationCheckInterval = null;
    }
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.stopRotationChecker();
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  private loadStore(): ExtendedKeyStore {
    if (fs.existsSync(this.storePath)) {
      try {
        const content = fs.readFileSync(this.storePath, "utf-8");
        const store = JSON.parse(content) as ExtendedKeyStore;
        
        // Ensure settings have defaults
        store.settings = {
          ...this.getDefaultSettings(),
          ...store.settings,
        };

        // Initialize rotation schedule if missing
        if (!store.rotationSchedule) {
          store.rotationSchedule = [];
        }

        return store;
      } catch {
        // Corrupted file, start fresh
      }
    }

    return {
      keys: [],
      agents: [],
      settings: this.getDefaultSettings(),
      version: "2.0.0",
      updatedAt: new Date().toISOString(),
      rotationSchedule: [],
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
      encryptionEnabled: this.isEncryptionEnabled(),
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
}

// =============================================================================
// Factory
// =============================================================================

export function createKeyManager(options: KeyManagerOptions): KeyManager {
  return new KeyManager(options);
}

/**
 * Create key manager with encryption from environment
 */
export function createKeyManagerFromEnv(storagePath: string): KeyManager {
  return new KeyManager({
    storagePath,
    encryptionKey: process.env.NELLA_AUTH_ENCRYPTION_KEY,
  });
}
