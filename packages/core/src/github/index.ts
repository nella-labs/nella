/**
 * GitHub Integration Module
 *
 * GitHub App integration for automatic repository indexing
 * via webhooks on PR and push events.
 */

export { GitHubService } from "./service";
export { WebhookHandler } from "./webhook-handler";

export type {
  GitHubRepoLink,
  GitHubWebhookEvent,
  GitHubWebhookPayload,
  GitHubFileChange,
  GitHubAppConfig,
  GitHubIndexAction,
  GitHubIndexJobData,
} from "./types";

export type {
  JobQueue,
  RepoLinkStore,
  WebhookHandlerDeps,
  WebhookResult,
} from "./webhook-handler";
