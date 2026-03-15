/**
 * Background Job Queue
 *
 * BullMQ-based job queue for async operations:
 * - Workspace indexing
 * - Cloud sync
 * - Cleanup tasks
 *
 * Falls back gracefully when Redis is unavailable.
 */

import { log } from "../utils/logger";

// BullMQ types — lazy loaded
let Queue: any = null;
let Worker: any = null;

let indexingQueue: any = null;
let syncQueue: any = null;
let cleanupQueue: any = null;

let indexingWorker: any = null;
let syncWorker: any = null;
let cleanupWorker: any = null;

/**
 * Initialize the job queue system.
 * Requires REDIS_URL to be set.
 */
export async function initJobQueue(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    log("info", "Job queue skipped — REDIS_URL not configured");
    return;
  }

  try {
    const bullmq = require("bullmq");
    Queue = bullmq.Queue;
    Worker = bullmq.Worker;
  } catch {
    log("warn", "BullMQ not installed — job queue disabled");
    return;
  }

  const connection = parseRedisUrl(redisUrl);

  // Create queues
  indexingQueue = new Queue("nella:indexing", { connection });
  syncQueue = new Queue("nella:sync", { connection });
  cleanupQueue = new Queue("nella:cleanup", { connection });

  // Create workers
  indexingWorker = new Worker(
    "nella:indexing",
    async (job: any) => {
      log("info", "Processing indexing job", { jobId: job.id, workspaceId: job.data.workspaceId });
      // TODO: Call SearchService.indexWorkspace() with progress reporting
      await job.updateProgress(100);
      return { status: "completed", workspaceId: job.data.workspaceId };
    },
    { connection, concurrency: 2 }
  );

  syncWorker = new Worker(
    "nella:sync",
    async (job: any) => {
      log("info", "Processing sync job", { jobId: job.id, workspaceId: job.data.workspaceId });
      // TODO: Call SyncManager
      return { status: "completed", workspaceId: job.data.workspaceId };
    },
    { connection, concurrency: 1 }
  );

  cleanupWorker = new Worker(
    "nella:cleanup",
    async (job: any) => {
      log("info", "Processing cleanup job", { jobId: job.id, type: job.data.type });
      // TODO: Cleanup expired sessions, old audit logs, stale cache
      return { status: "completed" };
    },
    { connection, concurrency: 1 }
  );

  // Worker error handling
  [indexingWorker, syncWorker, cleanupWorker].forEach((worker) => {
    worker.on("failed", (job: any, err: Error) => {
      log("error", `Job failed: ${job?.id}`, { error: err.message, queue: worker.name });
    });
  });

  log("info", "Job queues initialized", {
    queues: ["nella:indexing", "nella:sync", "nella:cleanup"],
  });
}

/**
 * Shutdown all workers and queues.
 */
export async function shutdownJobQueue(): Promise<void> {
  const workers = [indexingWorker, syncWorker, cleanupWorker].filter(Boolean);
  const queues = [indexingQueue, syncQueue, cleanupQueue].filter(Boolean);

  await Promise.all(workers.map((w) => w.close()));
  await Promise.all(queues.map((q) => q.close()));

  log("info", "Job queues shut down");
}

/**
 * Parse Redis URL into BullMQ connection options.
 */
function parseRedisUrl(url: string): Record<string, unknown> {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parseInt(parsed.port, 10) || 6379,
      password: parsed.password || undefined,
      tls: parsed.protocol === "rediss:" ? {} : undefined,
    };
  } catch {
    return { url };
  }
}
