/**
 * Corpus Loader
 *
 * Loads and validates injection/benign YAML corpus files from disk,
 * mapping snake_case YAML fields to camelCase TypeScript interfaces.
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import {
  InjectionSample,
  InjectionCategory,
  SampleDifficulty,
  ContentContext,
} from "./types";

// =============================================================================
// Raw YAML Types
// =============================================================================

interface RawSampleYaml {
  id?: unknown;
  content?: unknown;
  expected_detection?: unknown;
  expected_patterns?: unknown;
  expected_min_score?: unknown;
  expected_max_score?: unknown;
  difficulty?: unknown;
  context?: unknown;
  subcategory?: unknown;
}

interface RawCorpusFileYaml {
  category?: unknown;
  samples?: unknown;
}

// =============================================================================
// Corpus Metadata
// =============================================================================

export interface CorpusMetadata {
  version: string;
  description: string;
  totalExpectedSamples: number;
  categories: string[];
  lastUpdated: string;
}

interface RawMetadataYaml {
  version?: unknown;
  description?: unknown;
  total_expected_samples?: unknown;
  categories?: unknown;
  last_updated?: unknown;
}

// =============================================================================
// Load Result
// =============================================================================

export interface CorpusLoadResult {
  samples: InjectionSample[];
  errors: string[];
  metadata: CorpusMetadata;
}

// =============================================================================
// Validation Constants
// =============================================================================

const VALID_CATEGORIES: ReadonlySet<string> = new Set<InjectionCategory>([
  "instruction_override",
  "role_assumption",
  "system_prompt_request",
  "token_extraction",
  "authority_claim",
  "action_directive",
  "context_manipulation",
  "encoded_payload",
]);

const VALID_DIFFICULTIES: ReadonlySet<string> = new Set<SampleDifficulty>([
  "easy",
  "medium",
  "hard",
]);

const VALID_CONTEXTS: ReadonlySet<string> = new Set<ContentContext>([
  "code_comment",
  "readme",
  "jsdoc",
  "commit_msg",
  "inline",
  "function",
  "class",
  "doc",
  "docstring",
  "documentation",
  "config",
  "script",
]);

// =============================================================================
// Public API
// =============================================================================

/**
 * Load the full injection benchmark corpus from a directory.
 *
 * Reads all .yaml files from `<corpusDir>/injection/` and `<corpusDir>/benign/`,
 * validates each sample, and returns them alongside any validation errors.
 */
export function loadCorpus(corpusDir: string): CorpusLoadResult {
  const errors: string[] = [];
  const samples: InjectionSample[] = [];

  if (!fs.existsSync(corpusDir)) {
    return {
      samples: [],
      errors: [`Corpus directory not found: ${corpusDir}`],
      metadata: emptyMetadata(),
    };
  }

  // Load injection samples
  const injectionDir = path.join(corpusDir, "injection");
  if (fs.existsSync(injectionDir)) {
    const result = loadDirectory(injectionDir, false);
    samples.push(...result.samples);
    errors.push(...result.errors);
  }

  // Load benign samples
  const benignDir = path.join(corpusDir, "benign");
  if (fs.existsSync(benignDir)) {
    const result = loadDirectory(benignDir, true);
    samples.push(...result.samples);
    errors.push(...result.errors);
  }

  // Load metadata
  const metadata = loadMetadata(corpusDir, errors);

  // Check for duplicate IDs
  const seenIds = new Set<string>();
  for (const sample of samples) {
    if (seenIds.has(sample.id)) {
      errors.push(`Duplicate sample ID: ${sample.id}`);
    }
    seenIds.add(sample.id);
  }

  return { samples, errors, metadata };
}

// =============================================================================
// Directory Loading
// =============================================================================

function loadDirectory(
  dir: string,
  isBenign: boolean,
): { samples: InjectionSample[]; errors: string[] } {
  const samples: InjectionSample[] = [];
  const errors: string[] = [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    errors.push(
      `Failed to read directory ${dir}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { samples, errors };
  }

  const yamlFiles = entries
    .filter((e) => e.isFile() && (e.name.endsWith(".yaml") || e.name.endsWith(".yml")))
    .filter((e) => e.name !== "metadata.yaml")
    .map((e) => e.name);

  for (const file of yamlFiles) {
    const filePath = path.join(dir, file);
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const raw = yaml.load(content) as RawCorpusFileYaml;

      if (!raw || typeof raw !== "object") {
        errors.push(`${file}: Empty or invalid YAML`);
        continue;
      }

      const fileCategory = typeof raw.category === "string" ? raw.category : undefined;

      if (!Array.isArray(raw.samples)) {
        errors.push(`${file}: Missing or invalid 'samples' array`);
        continue;
      }

      for (let i = 0; i < raw.samples.length; i++) {
        const rawSample = raw.samples[i] as RawSampleYaml;
        const prefix = `${file}[${i}]`;
        const parsed = parseSample(rawSample, fileCategory, isBenign, prefix);

        if (parsed.sample) {
          samples.push(parsed.sample);
        }
        errors.push(...parsed.errors);
      }
    } catch (err) {
      errors.push(
        `${file}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { samples, errors };
}

// =============================================================================
// Sample Parsing & Validation
// =============================================================================

function parseSample(
  raw: RawSampleYaml,
  fileCategory: string | undefined,
  isBenign: boolean,
  prefix: string,
): { sample: InjectionSample | null; errors: string[] } {
  const errors: string[] = [];

  if (!raw || typeof raw !== "object") {
    errors.push(`${prefix}: Sample is not an object`);
    return { sample: null, errors };
  }

  // Required: id
  if (typeof raw.id !== "string" || raw.id.length === 0) {
    errors.push(`${prefix}: Missing or invalid 'id'`);
    return { sample: null, errors };
  }

  const id = raw.id;
  const tag = `${prefix} (${id})`;

  // Required: content
  if (typeof raw.content !== "string" || raw.content.length === 0) {
    errors.push(`${tag}: Missing or invalid 'content'`);
    return { sample: null, errors };
  }

  // Required: expected_detection
  if (typeof raw.expected_detection !== "boolean") {
    errors.push(`${tag}: Missing or invalid 'expected_detection' (must be boolean)`);
    return { sample: null, errors };
  }

  // Required: difficulty
  const difficulty = String(raw.difficulty ?? "");
  if (!VALID_DIFFICULTIES.has(difficulty)) {
    errors.push(
      `${tag}: Invalid difficulty '${difficulty}', expected one of: ${[...VALID_DIFFICULTIES].join(", ")}`,
    );
    return { sample: null, errors };
  }

  // Required: context
  const context = String(raw.context ?? "");
  if (!VALID_CONTEXTS.has(context)) {
    errors.push(
      `${tag}: Invalid context '${context}', expected one of: ${[...VALID_CONTEXTS].join(", ")}`,
    );
    return { sample: null, errors };
  }

  // Determine category
  const category: InjectionCategory | "benign" = isBenign
    ? "benign"
    : resolveCategory(fileCategory, tag, errors);

  if (!isBenign && category === "benign") {
    // resolveCategory already pushed an error
    return { sample: null, errors };
  }

  // expected_patterns
  const expectedPatterns = parseExpectedPatterns(raw.expected_patterns, tag, errors);

  // Optional scores
  const expectedMinScore = parseOptionalNumber(raw.expected_min_score, "expected_min_score", tag, errors);
  const expectedMaxScore = parseOptionalNumber(raw.expected_max_score, "expected_max_score", tag, errors);

  // subcategory
  const subcategory = typeof raw.subcategory === "string" ? raw.subcategory : "";

  const sample: InjectionSample = {
    id,
    content: raw.content as string,
    expectedDetection: raw.expected_detection as boolean,
    expectedPatterns,
    difficulty: difficulty as SampleDifficulty,
    context: context as ContentContext,
    category,
    subcategory,
  };

  if (expectedMinScore !== undefined) {
    sample.expectedMinScore = expectedMinScore;
  }
  if (expectedMaxScore !== undefined) {
    sample.expectedMaxScore = expectedMaxScore;
  }

  return { sample, errors };
}

function resolveCategory(
  fileCategory: string | undefined,
  tag: string,
  errors: string[],
): InjectionCategory | "benign" {
  if (!fileCategory) {
    errors.push(`${tag}: File missing 'category' field`);
    return "benign";
  }
  if (!VALID_CATEGORIES.has(fileCategory)) {
    errors.push(
      `${tag}: Invalid category '${fileCategory}', expected one of: ${[...VALID_CATEGORIES].join(", ")}`,
    );
    return "benign";
  }
  return fileCategory as InjectionCategory;
}

function parseExpectedPatterns(
  raw: unknown,
  tag: string,
  errors: string[],
): InjectionCategory[] {
  if (raw === undefined || raw === null) {
    return [];
  }

  if (!Array.isArray(raw)) {
    errors.push(`${tag}: 'expected_patterns' must be an array`);
    return [];
  }

  const patterns: InjectionCategory[] = [];
  for (const item of raw) {
    const value = String(item);
    if (VALID_CATEGORIES.has(value)) {
      patterns.push(value as InjectionCategory);
    } else {
      errors.push(`${tag}: Invalid pattern '${value}' in expected_patterns`);
    }
  }

  return patterns;
}

function parseOptionalNumber(
  raw: unknown,
  fieldName: string,
  tag: string,
  errors: string[],
): number | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }

  const value = Number(raw);
  if (isNaN(value)) {
    errors.push(`${tag}: '${fieldName}' must be a number, got '${raw}'`);
    return undefined;
  }

  return value;
}

// =============================================================================
// Metadata Loading
// =============================================================================

function loadMetadata(corpusDir: string, errors: string[]): CorpusMetadata {
  const metadataPath = path.join(corpusDir, "metadata.yaml");

  if (!fs.existsSync(metadataPath)) {
    return emptyMetadata();
  }

  try {
    const content = fs.readFileSync(metadataPath, "utf-8");
    const raw = yaml.load(content) as RawMetadataYaml;

    if (!raw || typeof raw !== "object") {
      errors.push("metadata.yaml: Empty or invalid YAML");
      return emptyMetadata();
    }

    return {
      version: typeof raw.version === "string" ? raw.version : "unknown",
      description: typeof raw.description === "string" ? raw.description : "",
      totalExpectedSamples:
        typeof raw.total_expected_samples === "number"
          ? raw.total_expected_samples
          : 0,
      categories: Array.isArray(raw.categories)
        ? raw.categories.map(String)
        : [],
      lastUpdated:
        typeof raw.last_updated === "string" ? raw.last_updated : "",
    };
  } catch (err) {
    errors.push(
      `metadata.yaml: ${err instanceof Error ? err.message : String(err)}`,
    );
    return emptyMetadata();
  }
}

function emptyMetadata(): CorpusMetadata {
  return {
    version: "unknown",
    description: "",
    totalExpectedSamples: 0,
    categories: [],
    lastUpdated: "",
  };
}
