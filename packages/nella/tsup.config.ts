import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
    "mcp/index": "src/mcp/index.ts",
    "mcp/server": "src/mcp/server.ts",
    "mcp/hosted-server": "src/mcp/hosted-server.ts",
  },
  format: ["cjs"],
  target: "node18",
  platform: "node",
  splitting: false,
  sourcemap: true,
  dts: true,
  clean: true,

  // Inline @usenella/core into the bundle
  noExternal: ["@usenella/core"],

  external: [
    // === Native / binary addons (MUST be external) ===
    "onnxruntime-node",
    "better-sqlite3",
    "usearch",
    "hnswlib-node",

    // === Heavy optional JS deps (keep external) ===
    "natural",
    "@typescript-eslint/typescript-estree",
    "@supabase/supabase-js",
    "pg",
    "@google-cloud/storage",
    "@msgpack/msgpack",
    "ioredis",
    "express",
    "ws",

    // === OpenTelemetry (loaded via dynamic tryRequire — can't bundle) ===
    "@opentelemetry/api",
    "@opentelemetry/sdk-node",
    "@opentelemetry/sdk-trace-base",
    "@opentelemetry/resources",
    "@opentelemetry/exporter-trace-otlp-http",

    // === nella's own external deps ===
    "@modelcontextprotocol/sdk",
    "chalk",
    "cli-table3",
    "dotenv",
    "figures",
    "js-yaml",
    "minimatch",
  ],
});
