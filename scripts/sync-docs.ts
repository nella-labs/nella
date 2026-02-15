#!/usr/bin/env tsx
/**
 * Docs Sync Script
 *
 * Syncs documentation from nella/docs to nella-website/apps/docs.
 * Transforms markdown to MDX format with proper frontmatter.
 *
 * Usage:
 *   pnpm sync-docs
 *   pnpm sync-docs --dry-run
 *   pnpm sync-docs --watch
 */

import * as fs from "fs";
import * as path from "path";

// =============================================================================
// Configuration
// =============================================================================

const SOURCE_DIR = path.resolve(__dirname, "../docs");
const TARGET_DIR = path.resolve(__dirname, "../../nella-website/apps/docs/src/content/docs");

interface SyncMapping {
  source: string;
  target: string;
  transform?: (content: string, filename: string, target: string) => string;
}

// Define how source docs map to target locations — MCP-focused only
const SYNC_MAPPINGS: SyncMapping[] = [
  // =========================================================================
  // Getting Started
  // =========================================================================
  {
    source: "getting-started/introduction.md",
    target: "getting-started/introduction.mdx",
    transform: transformGeneric,
  },
  {
    source: "getting-started/installation.md",
    target: "getting-started/installation.mdx",
    transform: transformGeneric,
  },
  {
    source: "getting-started/quick-start.md",
    target: "getting-started/quick-start.mdx",
    transform: transformGeneric,
  },

  // =========================================================================
  // MCP Tools
  // =========================================================================
  {
    source: "mcp/tools.md",
    target: "mcp-tools/overview.mdx",
    transform: transformToolsReference,
  },
  {
    source: "api-reference/tools/nella-check.md",
    target: "mcp-tools/nella-check.mdx",
    transform: transformGeneric,
  },
  {
    source: "api-reference/tools/nella-validate.md",
    target: "mcp-tools/nella-validate.mdx",
    transform: transformGeneric,
  },
  {
    source: "api-reference/tools/nella-run.md",
    target: "mcp-tools/nella-run.mdx",
    transform: transformGeneric,
  },
  {
    source: "api-reference/tools/nella-detect-risks.md",
    target: "mcp-tools/nella-detect-risks.mdx",
    transform: transformGeneric,
  },
  {
    source: "api-reference/tools/nella-should-refuse.md",
    target: "mcp-tools/nella-should-refuse.mdx",
    transform: transformGeneric,
  },
  {
    source: "api-reference/tools/nella-check-prerequisites.md",
    target: "mcp-tools/nella-check-prerequisites.mdx",
    transform: transformGeneric,
  },
  {
    source: "api-reference/tools/context-tools.md",
    target: "mcp-tools/context-tools.mdx",
    transform: transformGeneric,
  },

  // =========================================================================
  // Configuration
  // =========================================================================
  {
    source: "user-guide/task-authoring.md",
    target: "configuration/task-authoring.mdx",
    transform: transformGeneric,
  },
  {
    source: "configuration/constraints.md",
    target: "configuration/constraints.mdx",
    transform: transformGeneric,
  },
  {
    source: "configuration/validation.md",
    target: "configuration/validation.mdx",
    transform: transformGeneric,
  },

  // =========================================================================
  // Integrations
  // =========================================================================
  {
    source: "integrations/claude-desktop.md",
    target: "integrations/claude-desktop.mdx",
    transform: transformGeneric,
  },
  {
    source: "integrations/cursor.md",
    target: "integrations/cursor.mdx",
    transform: transformGeneric,
  },
  {
    source: "integrations/vscode.md",
    target: "integrations/vscode.mdx",
    transform: transformGeneric,
  },
  {
    source: "integrations/custom-client.md",
    target: "integrations/custom-client.mdx",
    transform: transformGeneric,
  },

  // =========================================================================
  // CLI
  // =========================================================================
  {
    source: "cli/commands.md",
    target: "cli/commands.mdx",
    transform: transformCliCommands,
  },

  // =========================================================================
  // Troubleshooting
  // =========================================================================
  {
    source: "troubleshooting.md",
    target: "troubleshooting/index.mdx",
    transform: transformGeneric,
  },
];

// =============================================================================
// Import Path Helper
// =============================================================================

/**
 * Compute the correct relative import prefix for MDX components
 * based on how deep the target file is in the content/docs/ directory.
 *
 * e.g. "guides/foo.mdx" → "../../../" (3 levels: guides → docs → content → src)
 *      "api-reference/tools/bar.mdx" → "../../../../" (4 levels)
 */
function getImportPrefix(target: string): string {
  const depth = target.split("/").length; // "a/b.mdx" → 2, "a/b/c.mdx" → 3
  // We need (depth + 2) levels of "../" to go from content/docs/<path> up to src/
  // Actually: from content/docs/section/file.mdx to src/components means:
  //   depth=2 → section/ + docs/ + content/ = 3 levels = "../../../"
  //   depth=3 → sub/section/ + docs/ + content/ = 4 levels = "../../../../"
  const levels = depth + 1; // +1 because we also traverse out of docs/ into content/ into src/
  return "../".repeat(levels);
}

// =============================================================================
// Frontmatter Templates
// =============================================================================

function generateFrontmatter(title: string, description: string, order?: number): string {
  // Quote values that contain special YAML chars
  const safeTitle = /[:#{}\[\]|>]/.test(title) ? `"${title.replace(/"/g, '\\"')}"` : title;
  const safeDesc = `"${description.replace(/"/g, '\\"')}"`;

  const frontmatter = [
    "---",
    `title: ${safeTitle}`,
    `description: ${safeDesc}`,
  ];

  if (order !== undefined) {
    frontmatter.push(`order: ${order}`);
  }

  frontmatter.push(
    `# Auto-generated from nella/docs - DO NOT EDIT DIRECTLY`,
    `# Source: nella/docs`,
    `# Last synced: ${new Date().toISOString()}`,
    "---",
    "",
  );

  return frontmatter.join("\n");
}

// =============================================================================
// Transform Functions
// =============================================================================

function extractTitle(content: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1] : "Documentation";
}

function extractDescription(content: string): string {
  // Get first paragraph after the title
  const lines = content.split("\n");
  let foundTitle = false;
  for (const line of lines) {
    if (line.startsWith("# ")) {
      foundTitle = true;
      continue;
    }
    if (foundTitle && line.trim() && !line.startsWith("#")) {
      // Strip markdown formatting and special chars that break YAML
      let desc = line.trim()
        .replace(/\*\*(.+?)\*\*/g, '$1')  // bold
        .replace(/\*(.+?)\*/g, '$1')      // italic
        .replace(/`(.+?)`/g, '$1')         // inline code
        .replace(/\[(.+?)\]\(.+?\)/g, '$1'); // links
      return desc.slice(0, 160);
    }
  }
  return "Nella documentation";
}

function transformGeneric(content: string, filename: string, target: string): string {
  const title = extractTitle(content);
  const description = extractDescription(content);
  const prefix = getImportPrefix(target);

  // Remove the first H1 title (we'll use frontmatter title)
  let transformed = content.replace(/^#\s+.+\r?\n+/, "");

  // Add imports for MDX components
  const imports = [
    `import Callout from '${prefix}components/mdx/Callout.astro';`,
    "",
  ].join("\n");

  // Convert markdown callouts to MDX Callout components
  transformed = convertCallouts(transformed);

  // Fix relative links
  transformed = fixRelativeLinks(transformed);

  return generateFrontmatter(title, description) + imports + transformed;
}

function transformToolsReference(content: string, filename: string, target: string): string {
  const title = "MCP Tools Reference";
  const description = "Complete reference for all tools exposed by the Nella MCP Server.";
  const prefix = getImportPrefix(target);

  let transformed = content.replace(/^#\s+.+\r?\n+/, "");

  const imports = [
    `import Callout from '${prefix}components/mdx/Callout.astro';`,
    `import APITable from '${prefix}components/mdx/APITable.astro';`,
    "",
  ].join("\n");

  transformed = convertCallouts(transformed);
  transformed = fixRelativeLinks(transformed);

  return generateFrontmatter(title, description, 10) + imports + transformed;
}

function transformCliCommands(content: string, filename: string, target: string): string {
  const title = "CLI Commands";
  const description = "Complete reference for the Nella CLI commands.";
  const prefix = getImportPrefix(target);

  let transformed = content.replace(/^#\s+.+\r?\n+/, "");

  const imports = [
    `import Callout from '${prefix}components/mdx/Callout.astro';`,
    "",
  ].join("\n");

  transformed = convertCallouts(transformed);
  transformed = fixRelativeLinks(transformed);

  return generateFrontmatter(title, description, 1) + imports + transformed;
}

// =============================================================================
// Helper Functions
// =============================================================================

function convertCallouts(content: string): string {
  // Convert > **Note:** ... to <Callout type="info">
  content = content.replace(
    />\s*\*\*Note:\*\*\s*(.+?)(?=\r?\n\r?\n|\r?\n>|\r?\n#|$)/gs,
    '<Callout type="info" title="Note">\n  $1\n</Callout>'
  );

  // Convert > **Warning:** ... to <Callout type="warning">
  content = content.replace(
    />\s*\*\*Warning:\*\*\s*(.+?)(?=\r?\n\r?\n|\r?\n>|\r?\n#|$)/gs,
    '<Callout type="warning" title="Warning">\n  $1\n</Callout>'
  );

  // Convert > **Tip:** ... to <Callout type="tip">
  content = content.replace(
    />\s*\*\*Tip:\*\*\s*(.+?)(?=\r?\n\r?\n|\r?\n#|$)/gs,
    '<Callout type="tip" title="Tip">\n  $1\n</Callout>'
  );

  return content;
}

function fixRelativeLinks(content: string): string {
  // Fix links to other docs sections
  content = content.replace(/\]\(\.\.\/mcp\//g, "](/api-reference/tools/");
  content = content.replace(/\]\(\.\.\/core\//g, "](/api-reference/");
  content = content.replace(/\]\(\.\.\/architecture\//g, "](/architecture/");
  content = content.replace(/\]\(\.\.\/getting-started\//g, "](/getting-started/");
  content = content.replace(/\]\(\.\.\/user-guide\//g, "](/user-guide/");
  content = content.replace(/\]\(\.\.\/configuration\//g, "](/configuration/");
  content = content.replace(/\]\(\.\.\/api-reference\//g, "](/api-reference/");
  content = content.replace(/\]\(\.\.\/guides\//g, "](/guides/");
  content = content.replace(/\]\(\.\.\/examples\//g, "](/examples/");
  content = content.replace(/\]\(\.\.\/benchmark\//g, "](/benchmark/");
  content = content.replace(/\]\(\.\//g, "](");

  // Remove .md extensions
  content = content.replace(/\.md\)/g, ")");
  content = content.replace(/\.md#/g, "#");

  // Escape bare < characters outside of code blocks/fences that would break MDX
  // e.g. "<2ms" → "&lt;2ms"
  content = escapeMdxAngleBrackets(content);

  return content;
}

/**
 * Escape < characters that MDX would interpret as JSX tags.
 * Preserves < inside code fences, inline code, and valid HTML/MDX tags.
 */
function escapeMdxAngleBrackets(content: string): string {
  const lines = content.split("\n");
  let inCodeFence = false;
  const result: string[] = [];

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      inCodeFence = !inCodeFence;
      result.push(line);
      continue;
    }
    if (inCodeFence) {
      result.push(line);
      continue;
    }
    // Outside code fences: escape < followed by a digit (like <2ms)
    // but NOT valid tags like <Callout, <div, <br/>, etc.
    result.push(line.replace(/<(\d)/g, "&lt;$1"));
  }

  return result.join("\n");
}

// =============================================================================
// Sync Logic
// =============================================================================

interface SyncOptions {
  dryRun?: boolean;
  verbose?: boolean;
}

function syncFile(mapping: SyncMapping, options: SyncOptions = {}): boolean {
  const sourcePath = path.join(SOURCE_DIR, mapping.source);
  const targetPath = path.join(TARGET_DIR, mapping.target);

  // Check if source exists
  if (!fs.existsSync(sourcePath)) {
    console.warn(`⚠️  Source not found: ${mapping.source}`);
    return false;
  }

  // Read source content
  const sourceContent = fs.readFileSync(sourcePath, "utf-8");

  // Transform content
  const transform = mapping.transform || transformGeneric;
  const transformedContent = transform(sourceContent, mapping.source, mapping.target);

  // Check if target exists and compare
  const targetExists = fs.existsSync(targetPath);
  if (targetExists) {
    const existingContent = fs.readFileSync(targetPath, "utf-8");
    // Remove timestamp line for comparison
    const normalizedExisting = existingContent.replace(/# Last synced: .+\n/, "");
    const normalizedNew = transformedContent.replace(/# Last synced: .+\n/, "");

    if (normalizedExisting === normalizedNew) {
      if (options.verbose) {
        console.log(`⏭️  No changes: ${mapping.target}`);
      }
      return false;
    }
  }

  if (options.dryRun) {
    console.log(`📝 Would sync: ${mapping.source} → ${mapping.target}`);
    return true;
  }

  // Ensure target directory exists
  const targetDir = path.dirname(targetPath);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Write transformed content
  fs.writeFileSync(targetPath, transformedContent, "utf-8");
  console.log(`✅ Synced: ${mapping.source} → ${mapping.target}`);

  return true;
}

function syncAll(options: SyncOptions = {}): void {
  console.log("\n🔄 Syncing documentation...\n");
  console.log(`   Source: ${SOURCE_DIR}`);
  console.log(`   Target: ${TARGET_DIR}\n`);

  let syncedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const mapping of SYNC_MAPPINGS) {
    try {
      const synced = syncFile(mapping, options);
      if (synced) {
        syncedCount++;
      } else {
        skippedCount++;
      }
    } catch (error) {
      console.error(`❌ Error syncing ${mapping.source}:`, error);
      errorCount++;
    }
  }

  console.log("\n📊 Summary:");
  console.log(`   Synced: ${syncedCount}`);
  console.log(`   Skipped: ${skippedCount}`);
  console.log(`   Errors: ${errorCount}`);

  if (options.dryRun) {
    console.log("\n   (Dry run - no files were modified)");
  }

  console.log("");
}

// =============================================================================
// CLI
// =============================================================================

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const verbose = args.includes("--verbose") || args.includes("-v");
const watch = args.includes("--watch");

if (watch) {
  console.log("👀 Watching for changes...\n");

  // Initial sync
  syncAll({ dryRun, verbose });

  // Watch source directory
  fs.watch(SOURCE_DIR, { recursive: true }, (eventType, filename) => {
    if (filename && (filename.endsWith(".md") || filename.endsWith(".mdx"))) {
      console.log(`\n📝 Change detected: ${filename}`);
      syncAll({ dryRun, verbose });
    }
  });
} else {
  syncAll({ dryRun, verbose });
}
