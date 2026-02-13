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
 * Enqueue an indexing job.
 */
export async function enqueueIndexingJob(workspaceId: string, options?: Record<string, unknown>): Promise<string | null> {
  if (!indexingQueue) return null;
  const job = await indexingQueue.add("index-workspace", { workspaceId, ...options });
  return job.id;
}

/**
 * Enqueue a sync job.
 */
export async function enqueueSyncJob(workspaceId: string): Promise<string | null> {
  if (!syncQueue) return null;
  const job = await syncQueue.add("sync-workspace", { workspaceId });
  return job.id;
}

/**
 * Enqueue a cleanup job.
 */
export async function enqueueCleanupJob(type: "sessions" | "audit" | "cache"): Promise<string | null> {
  if (!cleanupQueue) return null;
  const job = await cleanupQueue.add("cleanup", { type });
  return job.id;
}

/**
 * Get job status.
 */
export async function getJobStatus(queueName: string, jobId: string): Promise<any | null> {
  const queues: Record<string, any> = {
    indexing: indexingQueue,
    sync: syncQueue,
    cleanup: cleanupQueue,
  };
  const queue = queues[queueName];
  if (!queue) return null;
  const job = await queue.getJob(jobId);
  if (!job) return null;
  const state = await job.getState();
  return {
    id: job.id,
    state,
    progress: job.progress,
    data: job.data,
    result: job.returnvalue,
    failedReason: job.failedReason,
    createdAt: job.timestamp,
  };
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
