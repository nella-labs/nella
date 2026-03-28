/**
 * Dependency Graph Builder
 *
 * Builds a file-level dependency graph from indexed chunks and converts
 * it to an archgraph-compatible model for visualization.
 */

import * as path from "path";
import * as fs from "fs";
import type { CodeChunk, CodeSymbol } from "./types";

// =============================================================================
// Types
// =============================================================================

export interface GraphOptions {
  workspacePath: string;
  includeExternalPackages?: boolean;
  detectCircularDeps?: boolean;
  tsconfigPath?: string;
}

export interface FileNode {
  filePath: string;
  directory: string;
  language: string;
  exports: string[];
  symbols: CodeSymbol[];
  chunkCount: number;
  internalImports: string[];
  externalImports: string[];
}

export interface DependencyEdge {
  source: string;
  target: string;
  isExternal: boolean;
}

export interface DependencyGraph {
  files: Map<string, FileNode>;
  edges: DependencyEdge[];
  externalPackages: Set<string>;
  circularDependencies: string[][];
}

// Archgraph-compatible types (structural match, not imported)
interface ArchGraphModel {
  version: "1.0.0";
  metadata: {
    projectName: string;
    generatedAt: string;
    generatedBy: string;
    codebaseRoot: string;
  };
  objects: ArchObject[];
  connections: ArchConnection[];
  groups: ArchGroup[];
  technologies: ArchTechnology[];
  tags: ArchTag[];
  diagrams: ArchDiagram[];
  flows: ArchFlow[];
}

interface ArchObject {
  id: string;
  name: string;
  type: "actor" | "system" | "app" | "store" | "component";
  scope: "internal" | "external";
  status: "live" | "future" | "deprecated";
  description: string;
  parentId?: string;
  groups?: string[];
  technologies?: ArchTechnology[];
  tags?: ArchTag[];
  metadata?: { files?: string[] };
}

interface ArchConnection {
  id: string;
  sourceId: string;
  targetId: string;
  label: string;
  description?: string;
  status: "live" | "future" | "deprecated";
  type?: "sync" | "async" | "event" | "data";
  tags?: ArchTag[];
}

interface ArchGroup {
  id: string;
  name: string;
  parentGroupId?: string;
  objectIds: string[];
}

interface ArchTechnology {
  id: string;
  name: string;
  color?: string;
  category?: string;
}

interface ArchTag {
  id: string;
  name: string;
  color?: string;
}

interface ArchDiagram {
  id: string;
  name: string;
  level: 1 | 2 | 3;
  objectIds: string[];
  connectionIds: string[];
  positions: Record<string, { x: number; y: number }>;
}

interface ArchFlow {
  id: string;
  name: string;
  steps: { order: number; connectionId: string; description?: string }[];
}

// =============================================================================
// Import Resolution
// =============================================================================

type TsconfigPaths = Record<string, string[]>;

function parseTsconfigPaths(workspacePath: string, tsconfigPath?: string): TsconfigPaths | null {
  const configPath = tsconfigPath || path.join(workspacePath, "tsconfig.json");
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    // Strip comments (single-line only — good enough for paths)
    const stripped = raw.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const config = JSON.parse(stripped);
    return config?.compilerOptions?.paths || null;
  } catch {
    return null;
  }
}

function resolveAlias(
  specifier: string,
  tsconfigPaths: TsconfigPaths,
  workspacePath: string,
): string | null {
  for (const [pattern, targets] of Object.entries(tsconfigPaths)) {
    // Convert tsconfig pattern to prefix match: "@/*" -> "@/"
    const prefix = pattern.replace(/\*$/, "");
    if (specifier.startsWith(prefix)) {
      const rest = specifier.slice(prefix.length);
      for (const target of targets) {
        const targetPrefix = target.replace(/\*$/, "");
        return path.join(workspacePath, targetPrefix, rest);
      }
    }
  }
  return null;
}

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];
const INDEX_FILES = EXTENSIONS.map((ext) => `/index${ext}`);

function resolveRelativeImport(
  specifier: string,
  importerPath: string,
  knownFiles: Set<string>,
): string | null {
  const importerDir = path.dirname(importerPath);
  const basePath = path.resolve(importerDir, specifier);

  // Exact match
  if (knownFiles.has(basePath)) return basePath;

  // Try extensions
  for (const ext of EXTENSIONS) {
    const candidate = basePath + ext;
    if (knownFiles.has(candidate)) return candidate;
  }

  // Try index files
  for (const indexFile of INDEX_FILES) {
    const candidate = basePath + indexFile;
    if (knownFiles.has(candidate)) return candidate;
  }

  return null;
}

function extractPackageName(specifier: string): string {
  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    return parts.slice(0, 2).join("/");
  }
  return specifier.split("/")[0];
}

function resolveImport(
  specifier: string,
  importerPath: string,
  knownFiles: Set<string>,
  tsconfigPaths: TsconfigPaths | null,
  workspacePath: string,
): { resolvedPath: string | null; isExternal: boolean; packageName?: string } {
  // Relative import
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    const resolved = resolveRelativeImport(specifier, importerPath, knownFiles);
    return { resolvedPath: resolved, isExternal: false };
  }

  // Try tsconfig path alias
  if (tsconfigPaths) {
    const aliased = resolveAlias(specifier, tsconfigPaths, workspacePath);
    if (aliased) {
      const resolved = resolveRelativeImport(
        aliased,
        workspacePath + "/dummy.ts", // resolve from workspace root
        knownFiles,
      );
      if (resolved) return { resolvedPath: resolved, isExternal: false };
    }
  }

  // External package
  return {
    resolvedPath: null,
    isExternal: true,
    packageName: extractPackageName(specifier),
  };
}

// =============================================================================
// Graph Building
// =============================================================================

export function buildDependencyGraph(
  chunks: CodeChunk[],
  options: GraphOptions,
): DependencyGraph {
  const { workspacePath, includeExternalPackages = true, detectCircularDeps = true } = options;

  const tsconfigPaths = parseTsconfigPaths(workspacePath, options.tsconfigPath);

  // Collect all known file paths
  const knownFiles = new Set<string>();
  for (const chunk of chunks) {
    knownFiles.add(path.resolve(workspacePath, chunk.filePath));
  }

  // Aggregate chunks by file
  const fileMap = new Map<string, FileNode>();
  for (const chunk of chunks) {
    const absPath = path.resolve(workspacePath, chunk.filePath);
    let node = fileMap.get(absPath);
    if (!node) {
      node = {
        filePath: path.relative(workspacePath, absPath),
        directory: path.relative(workspacePath, path.dirname(absPath)),
        language: chunk.language,
        exports: [],
        symbols: [],
        chunkCount: 0,
        internalImports: [],
        externalImports: [],
      };
      fileMap.set(absPath, node);
    }

    node.chunkCount++;

    // Merge exports (deduplicated)
    if (chunk.exports) {
      for (const exp of chunk.exports) {
        if (!node.exports.includes(exp)) node.exports.push(exp);
      }
    }

    // Merge symbols (deduplicated by name+kind)
    for (const sym of chunk.symbols) {
      const exists = node.symbols.some((s) => s.name === sym.name && s.kind === sym.kind);
      if (!exists) node.symbols.push(sym);
    }

    // Resolve imports
    if (chunk.imports) {
      for (const spec of chunk.imports) {
        const result = resolveImport(spec, absPath, knownFiles, tsconfigPaths, workspacePath);
        if (result.isExternal) {
          const pkg = result.packageName!;
          if (!node.externalImports.includes(pkg)) node.externalImports.push(pkg);
        } else if (result.resolvedPath) {
          const relTarget = path.relative(workspacePath, result.resolvedPath);
          if (!node.internalImports.includes(relTarget)) node.internalImports.push(relTarget);
        }
      }
    }
  }

  // Build edges
  const edges: DependencyEdge[] = [];
  const externalPackages = new Set<string>();

  for (const [, node] of fileMap) {
    for (const target of node.internalImports) {
      edges.push({ source: node.filePath, target, isExternal: false });
    }
    if (includeExternalPackages) {
      for (const pkg of node.externalImports) {
        externalPackages.add(pkg);
        edges.push({ source: node.filePath, target: pkg, isExternal: true });
      }
    }
  }

  // Detect circular dependencies
  let circularDependencies: string[][] = [];
  if (detectCircularDeps) {
    circularDependencies = findCycles(fileMap);
  }

  return { files: fileMap, edges, externalPackages, circularDependencies };
}

// =============================================================================
// Cycle Detection (DFS)
// =============================================================================

function findCycles(fileMap: Map<string, FileNode>): string[][] {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const parent = new Map<string, string | null>();
  const cycles: string[][] = [];

  // Build adjacency from relative paths
  const adj = new Map<string, string[]>();
  for (const [, node] of fileMap) {
    adj.set(node.filePath, [...node.internalImports]);
  }

  for (const [, node] of fileMap) {
    color.set(node.filePath, WHITE);
  }

  function dfs(u: string, path: string[]): void {
    color.set(u, GRAY);
    const neighbors = adj.get(u) || [];

    for (const v of neighbors) {
      if (color.get(v) === GRAY) {
        // Found cycle — extract it from the path
        const cycleStart = path.indexOf(v);
        if (cycleStart !== -1) {
          const cycle = [...path.slice(cycleStart), v];
          cycles.push(cycle);
        }
      } else if (color.get(v) === WHITE) {
        parent.set(v, u);
        dfs(v, [...path, v]);
      }
    }

    color.set(u, BLACK);
  }

  for (const [, node] of fileMap) {
    if (color.get(node.filePath) === WHITE) {
      parent.set(node.filePath, null);
      dfs(node.filePath, [node.filePath]);
    }
  }

  return cycles;
}

// =============================================================================
// Archgraph Model Generation
// =============================================================================

function sanitizeId(input: string): string {
  return input
    .replace(/[^a-zA-Z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

const LANGUAGE_TECH: Record<string, ArchTechnology> = {
  typescript: { id: "tech-typescript", name: "TypeScript", color: "#3178c6", category: "language" },
  javascript: { id: "tech-javascript", name: "JavaScript", color: "#f7df1e", category: "language" },
  python: { id: "tech-python", name: "Python", color: "#3776ab", category: "language" },
  go: { id: "tech-go", name: "Go", color: "#00add8", category: "language" },
  rust: { id: "tech-rust", name: "Rust", color: "#dea584", category: "language" },
  java: { id: "tech-java", name: "Java", color: "#ed8b00", category: "language" },
  json: { id: "tech-json", name: "JSON", color: "#292929", category: "data" },
  markdown: { id: "tech-markdown", name: "Markdown", color: "#083fa1", category: "docs" },
};

export function dependencyGraphToArchgraphModel(
  graph: DependencyGraph,
  projectName: string,
): ArchGraphModel {
  const objects: ArchObject[] = [];
  const connections: ArchConnection[] = [];
  const groups: ArchGroup[] = [];
  const technologies = new Map<string, ArchTechnology>();
  const tags: ArchTag[] = [];
  const connectionSet = new Set<string>();

  const circularTag: ArchTag = { id: "tag-circular", name: "circular", color: "#ef4444" };
  const hasCircular = graph.circularDependencies.length > 0;
  if (hasCircular) tags.push(circularTag);

  // Build set of edges involved in cycles for tagging
  const circularEdges = new Set<string>();
  for (const cycle of graph.circularDependencies) {
    for (let i = 0; i < cycle.length - 1; i++) {
      circularEdges.add(`${cycle[i]}|${cycle[i + 1]}`);
    }
  }

  // Collect directories for grouping
  const dirFiles = new Map<string, string[]>();

  // Create file objects
  for (const [, node] of graph.files) {
    const fileId = `file-${sanitizeId(node.filePath)}`;
    const lang = node.language || "unknown";
    const tech = LANGUAGE_TECH[lang];
    if (tech) technologies.set(tech.id, tech);

    const dir = node.directory || ".";
    if (!dirFiles.has(dir)) dirFiles.set(dir, []);
    dirFiles.get(dir)!.push(fileId);

    const exportedSymbols = node.symbols.filter((s) => s.exported);
    const description = exportedSymbols.length > 0
      ? `Exports: ${exportedSymbols.map((s) => s.name).join(", ")}`
      : `${node.chunkCount} chunks`;

    objects.push({
      id: fileId,
      name: path.basename(node.filePath),
      type: "component",
      scope: "internal",
      status: "live",
      description,
      technologies: tech ? [tech] : undefined,
      metadata: { files: [node.filePath] },
    });
  }

  // Create external package objects
  for (const pkg of graph.externalPackages) {
    const pkgId = `pkg-${sanitizeId(pkg)}`;
    objects.push({
      id: pkgId,
      name: pkg,
      type: "store",
      scope: "external",
      status: "live",
      description: `External package: ${pkg}`,
    });
  }

  // No groups — keeps layouts flat so ELK can spread nodes
  // horizontally instead of stacking 90+ directory containers vertically.
  // Directory structure is represented by the Directory Overview diagram instead.

  // Create connections from edges
  for (const edge of graph.edges) {
    const sourceId = `file-${sanitizeId(edge.source)}`;
    const targetId = edge.isExternal
      ? `pkg-${sanitizeId(edge.target)}`
      : `file-${sanitizeId(edge.target)}`;
    const connKey = `${sourceId}-${targetId}`;

    if (connectionSet.has(connKey)) continue;
    connectionSet.add(connKey);

    const isCircular = circularEdges.has(`${edge.source}|${edge.target}`);
    const conn: ArchConnection = {
      id: `conn-${sanitizeId(connKey)}`,
      sourceId,
      targetId,
      label: edge.isExternal ? "depends on" : "imports",
      status: "live",
      type: edge.isExternal ? "data" : "sync",
    };
    if (isCircular) conn.tags = [circularTag];

    connections.push(conn);
  }

  // Build diagrams

  // Diagram 1: Directory Overview (L1)
  // One node per directory, connections aggregated between directories
  const dirObjects: ArchObject[] = [];
  const dirConnections: ArchConnection[] = [];
  const dirConnSet = new Set<string>();

  for (const [dir] of dirFiles) {
    const dirObjId = `dir-${sanitizeId(dir)}`;
    const fileCount = dirFiles.get(dir)!.length;
    dirObjects.push({
      id: dirObjId,
      name: dir === "." ? projectName : dir,
      type: "app",
      scope: "internal",
      status: "live",
      description: `${fileCount} file${fileCount === 1 ? "" : "s"}`,
    });
    objects.push(dirObjects[dirObjects.length - 1]);
  }

  // Aggregate internal edges to directory level
  for (const edge of graph.edges) {
    if (edge.isExternal) continue;
    const sourceNode = findFileNode(graph, edge.source);
    const targetNode = findFileNode(graph, edge.target);
    if (!sourceNode || !targetNode) continue;
    if (sourceNode.directory === targetNode.directory) continue;

    const sourceDir = `dir-${sanitizeId(sourceNode.directory || ".")}`;
    const targetDir = `dir-${sanitizeId(targetNode.directory || ".")}`;
    const key = `${sourceDir}-${targetDir}`;
    if (dirConnSet.has(key)) continue;
    dirConnSet.add(key);

    dirConnections.push({
      id: `conn-${sanitizeId(key)}`,
      sourceId: sourceDir,
      targetId: targetDir,
      label: "imports from",
      status: "live",
      type: "sync",
    });
    connections.push(dirConnections[dirConnections.length - 1]);
  }

  const dirDiagram: ArchDiagram = {
    id: "diagram-directories",
    name: "Directory Overview",
    level: 1,
    objectIds: dirObjects.map((o) => o.id),
    connectionIds: dirConnections.map((c) => c.id),
    positions: {},
  };

  // Diagram 2: File Dependencies (L2) — internal files only
  const internalFileIds = [...graph.files.values()].map((n) => `file-${sanitizeId(n.filePath)}`);
  const internalConnIds = connections
    .filter((c) => c.sourceId.startsWith("file-") && c.targetId.startsWith("file-"))
    .map((c) => c.id);

  const fileDiagram: ArchDiagram = {
    id: "diagram-files",
    name: "File Dependencies",
    level: 2,
    objectIds: internalFileIds,
    connectionIds: internalConnIds,
    positions: {},
  };

  // Diagram 3: Full Graph (L3) — everything
  const fullDiagram: ArchDiagram = {
    id: "diagram-full",
    name: "Full Dependency Graph",
    level: 3,
    objectIds: objects.map((o) => o.id),
    connectionIds: connections.map((c) => c.id),
    positions: {},
  };

  return {
    version: "1.0.0",
    metadata: {
      projectName,
      generatedAt: new Date().toISOString(),
      generatedBy: "nella",
      codebaseRoot: ".",
    },
    objects,
    connections,
    groups,
    technologies: [...technologies.values()],
    tags,
    diagrams: [dirDiagram, fileDiagram, fullDiagram],
    flows: [],
  };
}

function findFileNode(graph: DependencyGraph, relPath: string): FileNode | undefined {
  for (const [, node] of graph.files) {
    if (node.filePath === relPath) return node;
  }
  return undefined;
}
