/**
 * GitHub Webhook Handler
 *
 * Processes GitHub webhook events (push, pull_request) and dispatches
 * background indexing jobs. Handles PR lifecycle: open -> sync -> merge.
 */

import type {
  GitHubWebhookPayload,
  GitHubIndexJobData,
  GitHubRepoLink,
} from "./types";
import type { GitHubService } from "./service";

// =============================================================================
// Types
// =============================================================================

export interface JobQueue {
  /** Enqueue an indexing job. Returns the job ID. */
  add(name: string, data: GitHubIndexJobData): Promise<string>;
}

export interface RepoLinkStore {
  /** Find repo link by GitHub repo ID */
  findByRepoId(repoId: number): Promise<GitHubRepoLink | null>;
  /** Update repo link status */
  updateStatus(linkId: string, status: GitHubRepoLink["status"]): Promise<void>;
}

export interface WebhookHandlerDeps {
  githubService: GitHubService;
  jobQueue: JobQueue;
  repoLinkStore: RepoLinkStore;
}

export interface WebhookResult {
  handled: boolean;
  jobIds: string[];
  message: string;
}

// =============================================================================
// Webhook Handler
// =============================================================================

export class WebhookHandler {
  private deps: WebhookHandlerDeps;

  constructor(deps: WebhookHandlerDeps) {
    this.deps = deps;
  }

  /**
   * Process a webhook event.
   * Returns immediately — actual indexing happens async via job queue.
   */
  async handleEvent(event: string, payload: GitHubWebhookPayload): Promise<WebhookResult> {
    // Find the repo link for this repository
    const link = await this.deps.repoLinkStore.findByRepoId(payload.repository.id);
    if (!link) {
      return { handled: false, jobIds: [], message: "No linked workspace for this repository" };
    }

    if (link.status !== "active") {
      return { handled: false, jobIds: [], message: `Link is ${link.status}, skipping` };
    }

    switch (event) {
      case "push":
        return this.handlePush(payload, link);
      case "pull_request":
        return this.handlePullRequest(payload, link);
      default:
        return { handled: false, jobIds: [], message: `Unhandled event: ${event}` };
    }
  }

  // ===========================================================================
  // Push Events
  // ===========================================================================

  private async handlePush(
    payload: GitHubWebhookPayload,
    link: GitHubRepoLink,
  ): Promise<WebhookResult> {
    if (!payload.ref) {
      return { handled: false, jobIds: [], message: "No ref in push payload" };
    }

    // Extract branch name from ref (refs/heads/main -> main)
    const branch = payload.ref.replace("refs/heads/", "");

    // Only process pushes to the default branch
    if (branch !== link.defaultBranch) {
      return { handled: false, jobIds: [], message: `Push to ${branch}, not default branch` };
    }

    const changedFiles = this.deps.githubService.getPushChangedFiles(payload);
    if (changedFiles.length === 0) {
      return { handled: false, jobIds: [], message: "No file changes in push" };
    }

    const jobId = await this.deps.jobQueue.add("nella:github-index", {
      workspaceId: link.workspaceId,
      branch,
      changedFiles,
      action: "index-push",
      headCommit: payload.after,
      repoLinkId: link.id,
      installationId: link.installationId,
    });

    return {
      handled: true,
      jobIds: [jobId],
      message: `Queued re-index of ${changedFiles.length} files on ${branch}`,
    };
  }

  // ===========================================================================
  // Pull Request Events
  // ===========================================================================

  private async handlePullRequest(
    payload: GitHubWebhookPayload,
    link: GitHubRepoLink,
  ): Promise<WebhookResult> {
    if (!payload.pull_request) {
      return { handled: false, jobIds: [], message: "No pull_request in payload" };
    }

    const pr = payload.pull_request;
    const action = payload.action;
    const branch = pr.head.ref;

    // PR opened or synchronized (new push to PR branch)
    if (action === "opened" || action === "synchronize") {
      return this.handlePRSync(pr, branch, link);
    }

    // PR closed and merged
    if (action === "closed" && pr.merged) {
      return this.handlePRMerged(pr, branch, link);
    }

    return {
      handled: false,
      jobIds: [],
      message: `PR action ${action} not handled`,
    };
  }

  private async handlePRSync(
    pr: NonNullable<GitHubWebhookPayload["pull_request"]>,
    branch: string,
    link: GitHubRepoLink,
  ): Promise<WebhookResult> {
    // Get changed files from the PR
    const [owner, repo] = link.fullName.split("/");
    const files = await this.deps.githubService.getPRChangedFiles(
      link.installationId,
      owner,
      repo,
      pr.number,
    );

    const changedFiles = files
      .filter((f) => f.status !== "removed")
      .map((f) => f.filename);

    if (changedFiles.length === 0) {
      return { handled: false, jobIds: [], message: "No indexable file changes in PR" };
    }

    const jobId = await this.deps.jobQueue.add("nella:github-index", {
      workspaceId: link.workspaceId,
      branch,
      changedFiles,
      action: "index-branch",
      prNumber: pr.number,
      headCommit: pr.head.sha,
      repoLinkId: link.id,
      installationId: link.installationId,
    });

    return {
      handled: true,
      jobIds: [jobId],
      message: `Queued branch index for PR #${pr.number} (${changedFiles.length} files on ${branch})`,
    };
  }

  private async handlePRMerged(
    pr: NonNullable<GitHubWebhookPayload["pull_request"]>,
    branch: string,
    link: GitHubRepoLink,
  ): Promise<WebhookResult> {
    // Merge the branch index into main, then clean up
    const jobId = await this.deps.jobQueue.add("nella:github-index", {
      workspaceId: link.workspaceId,
      branch,
      changedFiles: [], // Not needed for merge action
      action: "merge-branch",
      prNumber: pr.number,
      headCommit: pr.head.sha,
      repoLinkId: link.id,
      installationId: link.installationId,
    });

    return {
      handled: true,
      jobIds: [jobId],
      message: `Queued branch merge for PR #${pr.number} (${branch} → ${pr.base.ref})`,
    };
  }
}
