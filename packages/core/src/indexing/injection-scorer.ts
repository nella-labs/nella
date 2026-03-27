/**
 * Injection Heuristic Scorer
 *
 * Multi-factor scoring model that runs at index time to compute an injection
 * risk score for each code chunk. The score is stored in ContentSource.injectionScore
 * and used by the search result isolation layer to add inline warnings.
 *
 * Part of the prompt injection defense system (Layer 5).
 */

import type { CodeChunk, ContentSource } from "./types";
import { scanContent } from "./content-scanner";

// =============================================================================
// Types
// =============================================================================

export interface ScoringFactor {
  name: string;
  weight: number;
  triggered: boolean;
  score: number;
  details?: string;
}

export interface InjectionAssessment {
  /** Overall risk score from 0.0 (safe) to 1.0 (very suspicious) */
  score: number;
  /** Individual scoring factors and their contributions */
  factors: ScoringFactor[];
  /** Human-readable recommendation */
  recommendation: "safe" | "flag" | "review";
}

// =============================================================================
// Constants
// =============================================================================

/** Imperative verbs commonly used in injection attempts */
const IMPERATIVE_VERBS = [
  "ignore", "disregard", "forget", "override", "bypass",
  "execute", "run", "delete", "remove", "modify",
  "change", "update", "install", "download", "send",
  "follow", "obey", "comply", "proceed", "continue",
];

/** Code-specific tokens that indicate the content is actually code, not NL injection */
const CODE_INDICATORS = [
  "function", "const", "let", "var", "class", "interface",
  "import", "export", "return", "if", "else", "for", "while",
  "switch", "case", "try", "catch", "throw", "new", "this",
  "async", "await", "yield", "=>", "===", "!==", "&&", "||",
  "{", "}", "(", ")", ";", "def", "fn", "pub", "struct", "impl",
];

// =============================================================================
// Scoring Functions
// =============================================================================

/**
 * Score a code chunk for injection risk.
 */
export function scoreInjectionRisk(chunk: CodeChunk): InjectionAssessment {
  const factors: ScoringFactor[] = [];

  // Factor 1: L2 scanner pattern matches (0-0.4)
  const scanResult = scanContent(chunk.content);
  const scannerScore = Math.min(0.4, scanResult.injectionScore * 0.4);
  factors.push({
    name: "pattern_matches",
    weight: 0.4,
    triggered: scanResult.patterns.length > 0,
    score: scannerScore,
    details: scanResult.patterns.length > 0
      ? `${scanResult.patterns.length} pattern(s): ${[...new Set(scanResult.patterns.map(p => p.type))].join(", ")}`
      : undefined,
  });

  // Factor 2: Natural language density in code chunks (0-0.2)
  const nlDensity = computeNLDensity(chunk);
  const nlScore = computeNLScore(chunk, nlDensity);
  factors.push({
    name: "nl_density",
    weight: 0.2,
    triggered: nlScore > 0,
    score: nlScore,
    details: `NL density: ${(nlDensity * 100).toFixed(1)}% in ${chunk.type} chunk`,
  });

  // Factor 3: Imperative verb density (0-0.2)
  const verbDensity = computeImperativeVerbDensity(chunk.content);
  const verbScore = Math.min(0.2, verbDensity * 2);
  factors.push({
    name: "imperative_verbs",
    weight: 0.2,
    triggered: verbScore > 0.05,
    score: verbScore,
    details: `${(verbDensity * 100).toFixed(1)} imperative verbs per 100 tokens`,
  });

  // Factor 4: Source origin base score (0-0.1)
  const originScore = computeOriginScore(chunk.source);
  factors.push({
    name: "source_origin",
    weight: 0.1,
    triggered: originScore > 0,
    score: originScore,
    details: chunk.source ? `Origin: ${chunk.source.origin}` : "Origin: unknown (default workspace)",
  });

  // Factor 5: Encoding anomalies (0-0.1)
  const encodingScore = computeEncodingScore(chunk.content);
  factors.push({
    name: "encoding_anomalies",
    weight: 0.1,
    triggered: encodingScore > 0,
    score: encodingScore,
  });

  // Compute total score (sum of individual factor scores, capped at 1.0)
  const totalScore = Math.min(1.0, factors.reduce((sum, f) => sum + f.score, 0));

  // Determine recommendation
  let recommendation: InjectionAssessment["recommendation"];
  if (totalScore < 0.2) {
    recommendation = "safe";
  } else if (totalScore < 0.5) {
    recommendation = "flag";
  } else {
    recommendation = "review";
  }

  return { score: totalScore, factors, recommendation };
}

/**
 * Compute natural language density (ratio of NL words to code tokens).
 */
function computeNLDensity(chunk: CodeChunk): number {
  const tokens = chunk.content.split(/\s+/).filter(t => t.length > 0);
  if (tokens.length === 0) return 0;

  const codeTokenCount = tokens.filter(t =>
    CODE_INDICATORS.some(ci => t.includes(ci))
  ).length;

  const nlTokenCount = tokens.length - codeTokenCount;
  return nlTokenCount / tokens.length;
}

/**
 * Score NL density contextually — high NL in a "function" or "class" chunk
 * is more suspicious than in a "doc" or "comment" chunk.
 */
function computeNLScore(chunk: CodeChunk, nlDensity: number): number {
  // Doc and comment chunks are expected to be mostly NL
  if (chunk.type === "doc" || chunk.type === "comment") {
    // Only flag if extremely NL-heavy AND contains suspicious patterns
    return nlDensity > 0.95 ? 0.05 : 0;
  }

  // Code chunks with high NL density are suspicious
  if (chunk.type === "function" || chunk.type === "class" || chunk.type === "module") {
    if (nlDensity > 0.8) return 0.2;
    if (nlDensity > 0.6) return 0.1;
    return 0;
  }

  // Other types: moderate sensitivity
  if (nlDensity > 0.9) return 0.15;
  if (nlDensity > 0.7) return 0.05;
  return 0;
}

/**
 * Count imperative verbs per 100 tokens.
 */
function computeImperativeVerbDensity(content: string): number {
  const tokens = content.toLowerCase().split(/\s+/).filter(t => t.length > 0);
  if (tokens.length === 0) return 0;

  const verbCount = tokens.filter(t =>
    IMPERATIVE_VERBS.some(v => t === v || t.startsWith(v + "s") || t.startsWith(v + "ing"))
  ).length;

  return (verbCount / tokens.length) * 100;
}

/**
 * Score based on content source origin.
 */
function computeOriginScore(source?: ContentSource): number {
  if (!source) return 0;

  switch (source.origin) {
    case "workspace":
      return 0;
    case "user_provided":
      return 0.03;
    case "external_repo":
      return 0.05;
    case "external_docs":
      return 0.1;
    default:
      return 0;
  }
}

/**
 * Detect encoding anomalies (zero-width chars, unusual unicode, etc.)
 */
function computeEncodingScore(content: string): number {
  let score = 0;

  // Zero-width characters
  const zeroWidthCount = (content.match(/[\u200B\u200C\u200D\uFEFF\u00AD]/g) || []).length;
  if (zeroWidthCount > 2) score += 0.05;

  // Unusual Unicode control characters (outside ASCII + common unicode)
  const controlChars = (content.match(/[\u0000-\u0008\u000E-\u001F\u007F-\u009F]/g) || []).length;
  if (controlChars > 3) score += 0.05;

  return Math.min(0.1, score);
}
