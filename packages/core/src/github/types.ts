/**
 * GitHub Integration Types
 *
 * Types for GitHub App integration, webhook handling,
 * and repository linking.
 */

// =============================================================================
// Repository Linking
// =============================================================================

export interface GitHubRepoLink {
  /** Unique link ID */
  id: string;
  /** User who created the link */
  userId: string;
  /** Workspace ID this repo is linked to */
  workspaceId: string;
  /** GitHub owner/repo (e.g., "acme/my-app") */
  fullName: string;
  /** GitHub repository ID (numeric) */
  repoId: number;
  /** Default branch */
  defaultBranch: string;
  /** Webhook ID registered on GitHub */
  webhookId: number | null;
  /** Webhook secret for signature verification */
  webhookSecret: string;
  /** GitHub App installation ID (for API access) */
  installationId: number;
  /** Events to listen for */
  events: GitHubWebhookEvent[];
  /** Link status */
  status: "active" | "pending" | "error" | "disconnected";
  /** Organization scoping */
  orgId?: string;
  /** Project scoping */
  projectId?: string;
  /** Timestamps */
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// Webhook Events
// =============================================================================

export type GitHubWebhookEvent = "push" | "pull_request" | "pull_request_review";

export interface GitHubWebhookPayload {
  action: string;
  repository: {
    id: number;
    full_name: string;
    default_branch: string;
    clone_url: string;
  };
  sender: {
    login: string;
    id: number;
  };
  /** Pull request payload (for pull_request events) */
  pull_request?: {
    number: number;
    title: string;
    head: {
      ref: string;
      sha: string;
      repo: { full_name: string };
    };
    base: {
      ref: string;
      sha: string;
    };
    merged: boolean;
    state: "open" | "closed";
    changed_files?: number;
  };
  /** Ref for push events (e.g., "refs/heads/main") */
  ref?: string;
  /** Before commit SHA for push events */
  before?: string;
  /** After commit SHA for push events */
  after?: string;
  /** Commits in push event */
  commits?: Array<{
    id: string;
    message: string;
    added: string[];
    modified: string[];
    removed: string[];
  }>;
  /** Installation info */
  installation?: {
    id: number;
  };
}

// =============================================================================
// File Changes
// =============================================================================

export interface GitHubFileChange {
  filename: string;
  status: "added" | "modified" | "removed" | "renamed" | "changed";
  previous_filename?: string;
  additions?: number;
  deletions?: number;
}

// =============================================================================
// GitHub App Configuration
// =============================================================================

export interface GitHubAppConfig {
  /** GitHub App ID */
  appId: number;
  /** PEM-encoded private key */
  privateKey: string;
  /** Webhook secret for signature verification */
  webhookSecret: string;
  /** OAuth Client ID */
  clientId: string;
  /** OAuth Client Secret */
  clientSecret: string;
}

// =============================================================================
// Indexing Job
// =============================================================================

export type GitHubIndexAction = "index-branch" | "merge-branch" | "index-push";

export interface GitHubIndexJobData {
  /** Workspace ID */
  workspaceId: string;
  /** Branch name */
  branch: string;
  /** Changed file paths */
  changedFiles: string[];
  /** Action to perform */
  action: GitHubIndexAction;
  /** PR number (for PR events) */
  prNumber?: number;
  /** Commit SHA */
  headCommit?: string;
  /** GitHub repo link ID */
  repoLinkId: string;
  /** Installation ID for API access */
  installationId: number;
}
