/**
 * GitHub Service
 *
 * GitHub App API client for webhook management, file change detection,
 * and repository access. Authenticates as a GitHub App using JWT,
 * then obtains installation tokens for API calls.
 */

import * as crypto from "crypto";
import type { GitHubAppConfig, GitHubFileChange, GitHubWebhookPayload } from "./types";

// =============================================================================
// GitHub Service
// =============================================================================

export class GitHubService {
  private config: GitHubAppConfig;
  private tokenCache: Map<number, { token: string; expiresAt: number }> = new Map();

  constructor(config: GitHubAppConfig) {
    this.config = config;
  }

  // ===========================================================================
  // Authentication
  // ===========================================================================

  /**
   * Generate a JWT for authenticating as the GitHub App.
   * JWTs are valid for up to 10 minutes.
   */
  private generateJWT(): string {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iat: now - 60, // Issued 60 seconds in the past to allow for clock drift
      exp: now + 600, // Expires in 10 minutes
      iss: this.config.appId,
    };

    // Build JWT manually (header.payload.signature)
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = crypto
      .createSign("RSA-SHA256")
      .update(`${header}.${body}`)
      .sign(this.config.privateKey, "base64url");

    return `${header}.${body}.${signature}`;
  }

  /**
   * Get an installation access token for API calls.
   * Caches tokens until they expire.
   */
  async getInstallationToken(installationId: number): Promise<string> {
    const cached = this.tokenCache.get(installationId);
    if (cached && cached.expiresAt > Date.now() + 60_000) {
      return cached.token;
    }

    const jwt = this.generateJWT();
    const response = await fetch(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to get installation token: ${response.status} ${text}`);
    }

    const data = (await response.json()) as { token: string; expires_at: string };
    this.tokenCache.set(installationId, {
      token: data.token,
      expiresAt: new Date(data.expires_at).getTime(),
    });

    return data.token;
  }

  // ===========================================================================
  // Webhook Management
  // ===========================================================================

  /**
   * Register a webhook on a repository.
   * Returns the webhook ID.
   */
  async registerWebhook(
    installationId: number,
    owner: string,
    repo: string,
    callbackUrl: string,
    events: string[] = ["push", "pull_request"],
  ): Promise<number> {
    const token = await this.getInstallationToken(installationId);
    const secret = crypto.randomBytes(32).toString("hex");

    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/hooks`,
      {
        method: "POST",
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          name: "web",
          active: true,
          events,
          config: {
            url: callbackUrl,
            content_type: "json",
            secret,
            insecure_ssl: "0",
          },
        }),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to register webhook: ${response.status} ${text}`);
    }

    const hook = (await response.json()) as { id: number };
    return hook.id;
  }

  /**
   * Remove a webhook from a repository.
   */
  async removeWebhook(
    installationId: number,
    owner: string,
    repo: string,
    hookId: number,
  ): Promise<void> {
    const token = await this.getInstallationToken(installationId);

    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/hooks/${hookId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );

    if (!response.ok && response.status !== 404) {
      const text = await response.text();
      throw new Error(`Failed to remove webhook: ${response.status} ${text}`);
    }
  }

  // ===========================================================================
  // Changed Files
  // ===========================================================================

  /**
   * Get files changed in a pull request.
   * Handles pagination for large PRs.
   */
  async getPRChangedFiles(
    installationId: number,
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<GitHubFileChange[]> {
    const token = await this.getInstallationToken(installationId);
    const files: GitHubFileChange[] = [];
    let page = 1;

    while (true) {
      const response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100&page=${page}`,
        {
          headers: {
            Authorization: `token ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        },
      );

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to get PR files: ${response.status} ${text}`);
      }

      const pageFiles = (await response.json()) as GitHubFileChange[];
      files.push(...pageFiles);

      if (pageFiles.length < 100) break;
      page++;
    }

    return files;
  }

  /**
   * Extract changed files from a push webhook payload.
   * Deduplicates across all commits.
   */
  getPushChangedFiles(payload: GitHubWebhookPayload): string[] {
    if (!payload.commits) return [];

    const files = new Set<string>();
    for (const commit of payload.commits) {
      for (const f of commit.added) files.add(f);
      for (const f of commit.modified) files.add(f);
      for (const f of commit.removed) files.add(f);
    }
    return [...files];
  }

  // ===========================================================================
  // Webhook Signature Verification
  // ===========================================================================

  /**
   * Verify a GitHub webhook signature (HMAC-SHA256).
   * Uses timing-safe comparison to prevent timing attacks.
   */
  verifyWebhookSignature(payload: string | Buffer, signature: string, secret: string): boolean {
    const expected = "sha256=" + crypto
      .createHmac("sha256", secret)
      .update(payload)
      .digest("hex");

    try {
      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expected),
      );
    } catch {
      return false;
    }
  }

  // ===========================================================================
  // File Content
  // ===========================================================================

  /**
   * Fetch file content from a repository at a specific ref.
   */
  async getFileContent(
    installationId: number,
    owner: string,
    repo: string,
    filePath: string,
    ref: string,
  ): Promise<string> {
    const token = await this.getInstallationToken(installationId);

    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${ref}`,
      {
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github.raw+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to get file content: ${response.status} ${text}`);
    }

    return response.text();
  }
}
