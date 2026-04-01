/**
 * Environment Configuration
 *
 * Zod-validated environment variables for the Nella API server.
 * Fails fast on invalid config at startup.
 */

import { z } from "zod";

const envSchema = z.object({
  // Server
  PORT: z.coerce.number().default(8080),
  HOST: z.string().default("0.0.0.0"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // Database / Cache
  REDIS_URL: z.string().optional(),
  DATABASE_URL: z.string().optional(),

  // Supabase
  SUPABASE_URL: z.string().min(1, "SUPABASE_URL is required"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),

  // Auth
  JWT_SECRET: z.string().optional(),
  API_KEY_SALT: z.string().optional(),

  // Voyage AI via MongoDB Atlas (embeddings + reranking)
  VOYAGE_API_KEY: z.string().optional(),
  VOYAGE_ENDPOINT: z.string().optional().default("https://ai.mongodb.com/v1"),

  // Azure OpenAI (embeddings) — legacy fallback
  AZURE_EMBEDDING_API_KEY: z.string().optional(),
  AZURE_ENDPOINT: z.string().optional(),
  AZURE_EMBEDDING_DEPLOYMENT: z.string().optional(),

  // Azure AI Cohere (reranking) — legacy fallback
  AZURE_RERANK_API_KEY: z.string().optional(),
  AZURE_RERANK_ENDPOINT: z.string().optional(),

  // CORS
  ALLOWED_ORIGINS: z
    .string()
    .optional()
    .transform((val) =>
      val ? val.split(",").map((s) => s.trim()) : ["https://app.getnella.dev", "https://docs.getnella.dev", "http://localhost:5173"]
    ),

  // Logging
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type Config = z.infer<typeof envSchema>;

let _config: Config | null = null;

export function loadConfig(): Config {
  if (_config) return _config;

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    console.error(`❌ Invalid environment configuration:\n${formatted}`);
    process.exit(1);
  }

  _config = result.data;
  return _config;
}

export function getConfig(): Config {
  if (!_config) return loadConfig();
  return _config;
}
