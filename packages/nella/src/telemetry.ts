/**
 * Telemetry configuration and consent management for Nella CLI.
 *
 * Follows industry standards (Next.js, Astro, Vercel CLI):
 * - Opt-out by default with first-run notice
 * - CLI command to enable/disable: `nella telemetry enable|disable`
 * - Environment variables: NELLA_TELEMETRY_DISABLED=1, DO_NOT_TRACK=1
 * - Auto-disabled in CI environments
 * - Anonymous UUID stored at ~/.nella/telemetry.json (not hardware-derived)
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";

const NELLA_DIR = path.join(os.homedir(), ".nella");
const TELEMETRY_FILE = path.join(NELLA_DIR, "telemetry.json");

interface TelemetryConfig {
  enabled: boolean;
  id: string;
  noticeShown: boolean;
}

function isCI(): boolean {
  return !!(
    process.env.CI ||
    process.env.GITHUB_ACTIONS ||
    process.env.GITLAB_CI ||
    process.env.CIRCLECI ||
    process.env.JENKINS_URL ||
    process.env.BUILDKITE ||
    process.env.TRAVIS ||
    process.env.TF_BUILD ||
    process.env.CODEBUILD_BUILD_ID
  );
}

function loadConfig(): TelemetryConfig {
  try {
    if (fs.existsSync(TELEMETRY_FILE)) {
      const raw = fs.readFileSync(TELEMETRY_FILE, "utf-8");
      return JSON.parse(raw);
    }
  } catch {
    // Corrupted file — start fresh
  }
  return {
    enabled: true,
    id: crypto.randomUUID(),
    noticeShown: false,
  };
}

function saveConfig(config: TelemetryConfig): void {
  try {
    if (!fs.existsSync(NELLA_DIR)) {
      fs.mkdirSync(NELLA_DIR, { recursive: true });
    }
    fs.writeFileSync(TELEMETRY_FILE, JSON.stringify(config, null, 2), "utf-8");
  } catch {
    // Non-critical — ignore filesystem errors
  }
}

/**
 * Check if telemetry is enabled.
 * Priority: env vars > CI detection > config file.
 */
export function isTelemetryEnabled(): boolean {
  // Env vars take precedence
  if (process.env.NELLA_TELEMETRY_DISABLED === "1") return false;
  if (process.env.DO_NOT_TRACK === "1") return false;

  // Auto-disable in CI
  if (isCI()) return false;

  const config = loadConfig();
  return config.enabled;
}

/**
 * Set telemetry enabled/disabled.
 */
export function setTelemetryEnabled(enabled: boolean): void {
  const config = loadConfig();
  config.enabled = enabled;
  config.noticeShown = true;
  saveConfig(config);
}

/**
 * Get the anonymous telemetry ID.
 */
export function getTelemetryId(): string {
  const config = loadConfig();
  return config.id;
}

/**
 * Reset the anonymous telemetry ID.
 */
export function resetTelemetryId(): void {
  const config = loadConfig();
  config.id = crypto.randomUUID();
  saveConfig(config);
}

/**
 * Check if the first-run notice has been shown.
 */
export function hasShownNotice(): boolean {
  const config = loadConfig();
  return config.noticeShown;
}

/**
 * Mark the first-run notice as shown.
 */
export function markNoticeShown(): void {
  const config = loadConfig();
  config.noticeShown = true;
  saveConfig(config);
}

/**
 * Get telemetry status summary for `nella telemetry status`.
 */
export function getTelemetryStatus(): {
  enabled: boolean;
  id: string;
  reason?: string;
} {
  const config = loadConfig();
  let enabled = config.enabled;
  let reason: string | undefined;

  if (process.env.NELLA_TELEMETRY_DISABLED === "1") {
    enabled = false;
    reason = "NELLA_TELEMETRY_DISABLED=1";
  } else if (process.env.DO_NOT_TRACK === "1") {
    enabled = false;
    reason = "DO_NOT_TRACK=1";
  } else if (isCI()) {
    enabled = false;
    reason = "CI environment detected";
  } else if (!config.enabled) {
    reason = "disabled via nella telemetry disable";
  }

  return { enabled, id: config.id, reason };
}
