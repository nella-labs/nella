/**
 * Benchmark Config Loader
 *
 * Loads benchmark configuration from YAML and merges CLI overrides.
 */

import * as fs from "fs";
import * as yaml from "js-yaml";

// =============================================================================
// Types
// =============================================================================

export interface BenchmarkConfig {
  version: string;
  scanner: {
    threshold: number;
    corpus: string;
  };
  agent: {
    scenarios: string | string[];
    runsPerScenario: number;
    maxTurns: number;
    withNella: boolean;
    withoutNella: boolean;
    seed: number | null;
  };
  output: {
    dir: string;
    formats: string[];
    website: boolean;
  };
}

// =============================================================================
// Defaults
// =============================================================================

const DEFAULT_CONFIG: BenchmarkConfig = {
  version: "2.0.0",
  scanner: {
    threshold: 0.2,
    corpus: "./corpus",
  },
  agent: {
    scenarios: "all",
    runsPerScenario: 3,
    maxTurns: 5,
    withNella: true,
    withoutNella: false,
    seed: null,
  },
  output: {
    dir: "./benchmark-results",
    formats: ["json", "csv", "md"],
    website: true,
  },
};

// =============================================================================
// Validation
// =============================================================================

function validateConfig(raw: unknown): asserts raw is Partial<BenchmarkConfig> {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Config must be a YAML object");
  }

  const obj = raw as Record<string, unknown>;

  if (obj.version !== undefined && typeof obj.version !== "string") {
    throw new Error(`Invalid config: "version" must be a string`);
  }

  if (obj.scanner !== undefined) {
    if (typeof obj.scanner !== "object" || obj.scanner === null) {
      throw new Error(`Invalid config: "scanner" must be an object`);
    }
    const scanner = obj.scanner as Record<string, unknown>;
    if (scanner.threshold !== undefined && typeof scanner.threshold !== "number") {
      throw new Error(`Invalid config: "scanner.threshold" must be a number`);
    }
    if (scanner.corpus !== undefined && typeof scanner.corpus !== "string") {
      throw new Error(`Invalid config: "scanner.corpus" must be a string`);
    }
  }

  if (obj.agent !== undefined) {
    if (typeof obj.agent !== "object" || obj.agent === null) {
      throw new Error(`Invalid config: "agent" must be an object`);
    }
    const agent = obj.agent as Record<string, unknown>;
    if (
      agent.scenarios !== undefined &&
      typeof agent.scenarios !== "string" &&
      !Array.isArray(agent.scenarios)
    ) {
      throw new Error(`Invalid config: "agent.scenarios" must be a string or array`);
    }
    if (agent.runsPerScenario !== undefined && typeof agent.runsPerScenario !== "number") {
      throw new Error(`Invalid config: "agent.runsPerScenario" must be a number`);
    }
    if (agent.maxTurns !== undefined && typeof agent.maxTurns !== "number") {
      throw new Error(`Invalid config: "agent.maxTurns" must be a number`);
    }
    if (agent.seed !== undefined && agent.seed !== null && typeof agent.seed !== "number") {
      throw new Error(`Invalid config: "agent.seed" must be a number or null`);
    }
  }

  if (obj.output !== undefined) {
    if (typeof obj.output !== "object" || obj.output === null) {
      throw new Error(`Invalid config: "output" must be an object`);
    }
    const output = obj.output as Record<string, unknown>;
    if (output.dir !== undefined && typeof output.dir !== "string") {
      throw new Error(`Invalid config: "output.dir" must be a string`);
    }
    if (output.formats !== undefined && !Array.isArray(output.formats)) {
      throw new Error(`Invalid config: "output.formats" must be an array`);
    }
  }
}

// =============================================================================
// Deep merge helper
// =============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
function deepMerge<T>(base: T, override: Partial<T>): T {
  const result = { ...base } as any;
  const src = override as any;

  for (const key of Object.keys(src)) {
    const overrideVal = src[key];
    if (overrideVal === undefined) continue;

    const baseVal = result[key];
    if (
      typeof baseVal === "object" &&
      baseVal !== null &&
      !Array.isArray(baseVal) &&
      typeof overrideVal === "object" &&
      overrideVal !== null &&
      !Array.isArray(overrideVal)
    ) {
      result[key] = deepMerge(baseVal, overrideVal);
    } else {
      result[key] = overrideVal;
    }
  }

  return result as T;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// =============================================================================
// Public API
// =============================================================================

/**
 * Load benchmark configuration from a YAML file.
 * Missing fields are filled from defaults.
 */
export function loadConfig(configPath: string): BenchmarkConfig {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const raw = yaml.load(fs.readFileSync(configPath, "utf-8"));
  validateConfig(raw);

  return deepMerge(DEFAULT_CONFIG, raw as Partial<BenchmarkConfig>);
}

/**
 * Merge CLI overrides into an existing config.
 * Only provided (non-undefined) fields are overwritten.
 */
export function mergeCliOverrides(
  config: BenchmarkConfig,
  overrides: Partial<BenchmarkConfig>,
): BenchmarkConfig {
  return deepMerge(config, overrides);
}
