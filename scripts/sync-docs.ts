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
  transform?: (content: string, filename: string) => string;
}

// Define how source docs map to target locations
const SYNC_MAPPINGS: SyncMapping[] = [
  // MCP Tools
  {
    source: "mcp/tools.md",
    target: "api-reference/tools-reference.mdx",
    transform: transformToolsReference,
  },
  {
    source: "mcp/context.md",
    target: "guides/context-management.mdx",
    transform: transformGeneric,
  },
  {
    source: "mcp/examples.md",
    target: "examples/mcp-examples.mdx",
    transform: transformGeneric,
  },
  {
    source: "mcp/integration.md",
    target: "guides/mcp-integration.mdx",
    transform: transformGeneric,
  },
  {
    source: "mcp/README.md",
    target: "api-reference/mcp-overview.mdx",
    transform: transformGeneric,
  },

  // Core Library
  {
    source: "core/api-reference.md",
    target: "api-reference/core-api.mdx",
    transform: transformCoreApi,
  },
  {
    source: "core/configuration.md",
    target: "configuration/core-config.mdx",
    transform: transformConfiguration,
  },
  {
    source: "core/auth.md",
    target: "guides/authentication.mdx",
    transform: transformGeneric,
  },
  {
    source: "core/context-sharing.md",
    target: "guides/context-sharing.mdx",
    transform: transformGeneric,
  },
  {
    source: "core/indexing.md",
    target: "guides/indexing.mdx",
    transform: transformGeneric,
  },
  {
    source: "core/workspace.md",
    target: "guides/workspace.mdx",
    transform: transformGeneric,
  },
  {
    source: "core/agents.md",
    target: "guides/agents.mdx",
    transform: transformGeneric,
  },
  {
    source: "core/playground.md",
    target: "guides/playground.mdx",
    transform: transformGeneric,
  },
  {
    source: "core/export.md",
    target: "guides/export.mdx",
    transform: transformGeneric,
  },
  {
    source: "core/sync.md",
    target: "guides/cloud-sync.mdx",
    transform: transformGeneric,
  },
  {
    source: "core/rate-limiting.md",
    target: "guides/rate-limiting.mdx",
    transform: transformGeneric,
  },
  {
    source: "core/types.md",
    target: "api-reference/types.mdx",
    transform: transformGeneric,
  },
  {
    source: "core/examples.md",
    target: "examples/core-examples.mdx",
    transform: transformGeneric,
  },

  // CLI
  {
    source: "cli/commands.md",
    target: "cli/commands.mdx",
    transform: transformCliCommands,
  },
  {
    source: "cli/examples.md",
    target: "cli/cli-examples.mdx",
    transform: transformGeneric,
  },

  // Getting Started
  {
    source: "how-to-use.md",
    target: "getting-started/usage-guide.mdx",
    transform: transformUsageGuide,
  },
  {
    source: "spec.md",
    target: "guides/specification.mdx",
    transform: transformGeneric,
  },
];

// =============================================================================
// Frontmatter Templates
// =============================================================================

function generateFrontmatter(title: string, description: string, order?: number): string {
  const frontmatter = [
    "---",
    `title: ${title}`,
    `description: ${description}`,
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
      return line.trim().slice(0, 160);
    }
  }
  return "Nella documentation";
}

function transformGeneric(content: string, filename: string): string {
  const title = extractTitle(content);
  const description = extractDescription(content);

  // Remove the first H1 title (we'll use frontmatter title)
  let transformed = content.replace(/^#\s+.+\r?\n+/, "");

  // Add imports for MDX components
  const imports = [
    "import Callout from '../../../components/mdx/Callout.astro';",
    "",
  ].join("\n");

  // Convert markdown callouts to MDX Callout components
  transformed = convertCallouts(transformed);

  // Fix relative links
  transformed = fixRelativeLinks(transformed);

  return generateFrontmatter(title, description) + imports + transformed;
}

function transformToolsReference(content: string, filename: string): string {
  const title = "MCP Tools Reference";
  const description = "Complete reference for all tools exposed by the Nella MCP Server.";

  let transformed = content.replace(/^#\s+.+\r?\n+/, "");

  const imports = [
    "import Callout from '../../../components/mdx/Callout.astro';",
    "import APITable from '../../../components/mdx/APITable.astro';",
    "",
  ].join("\n");

  transformed = convertCallouts(transformed);
  transformed = fixRelativeLinks(transformed);

  return generateFrontmatter(title, description, 10) + imports + transformed;
}

function transformCoreApi(content: string, filename: string): string {
  const title = "Core API Reference";
  const description = "Complete API documentation for @usenella/core TypeScript library.";

  let transformed = content.replace(/^#\s+.+\r?\n+/, "");

  const imports = [
    "import Callout from '../../../components/mdx/Callout.astro';",
    "import APITable from '../../../components/mdx/APITable.astro';",
    "",
  ].join("\n");

  transformed = convertCallouts(transformed);
  transformed = fixRelativeLinks(transformed);

  return generateFrontmatter(title, description, 11) + imports + transformed;
}

function transformConfiguration(content: string, filename: string): string {
  const title = "Configuration Reference";
  const description = "Configuration options and task definition schema for @usenella/core.";

  let transformed = content.replace(/^#\s+.+\r?\n+/, "");

  const imports = [
    "import Callout from '../../../components/mdx/Callout.astro';",
    "",
  ].join("\n");

  transformed = convertCallouts(transformed);
  transformed = fixRelativeLinks(transformed);

  return generateFrontmatter(title, description, 4) + imports + transformed;
}

function transformUsageGuide(content: string, filename: string): string {
  const title = "How to Use Nella";
  const description = "End-to-end guide for using Nella to validate agent changes.";

  let transformed = content.replace(/^#\s+.+\r?\n+/, "");

  const imports = [
    "import Callout from '../../../components/mdx/Callout.astro';",
    "",
  ].join("\n");

  transformed = convertCallouts(transformed);
  transformed = fixRelativeLinks(transformed);

  return generateFrontmatter(title, description, 4) + imports + transformed;
}

function transformCliCommands(content: string, filename: string): string {
  const title = "CLI Commands";
  const description = "Complete reference for the Nella CLI commands.";

  let transformed = content.replace(/^#\s+.+\r?\n+/, "");

  const imports = [
    "import Callout from '../../../components/mdx/Callout.astro';",
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
  // Fix links to other docs
  content = content.replace(/\]\(\.\.\/mcp\//g, "](/api-reference/tools/");
  content = content.replace(/\]\(\.\.\/core\//g, "](/api-reference/");
  content = content.replace(/\]\(\.\//g, "](");

  // Remove .md extensions
  content = content.replace(/\.md\)/g, ")");
  content = content.replace(/\.md#/g, "#");

  return content;
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
  const transformedContent = transform(sourceContent, mapping.source);

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
