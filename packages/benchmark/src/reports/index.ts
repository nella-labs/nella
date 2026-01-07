/**
 * Reports Index
 *
 * Export report generation utilities
 */

export {
  appendResult,
  readResults,
  clearResults,
} from "./jsonl-writer";

export {
  generateSummaryMarkdown,
  writeSummaryMarkdown,
  MarkdownGeneratorOptions,
} from "./markdown-generator";

export {
  writeArtifacts,
  createLogEntry,
  getArtifactDir,
  ArtifactWriterOptions,
} from "./artifact-writer";

export {
  collectAllRuns,
  generateDashboardHtml,
  writeDashboard,
} from "./dashboard-generator";
