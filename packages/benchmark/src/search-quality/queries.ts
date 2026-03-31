/**
 * Search Quality Ground Truth Queries
 *
 * 50 queries mapped to specific files in the fixture project.
 * Covers function lookups, bug descriptions, concept searches,
 * and cross-file dependency queries.
 */

import type { SearchGroundTruth } from "./types";

export function getQueries(): SearchGroundTruth[] {
  return [
    // =========================================================================
    // function_lookup (15 queries)
    // =========================================================================
    {
      id: "fl-01",
      query: "where is email validation defined",
      relevantFiles: ["src/utils/validation.ts"],
      type: "function_lookup",
      difficulty: "easy",
    },
    {
      id: "fl-02",
      query: "function that hashes passwords",
      relevantFiles: ["src/utils/crypto.ts"],
      type: "function_lookup",
      difficulty: "easy",
    },
    {
      id: "fl-03",
      query: "JWT token verification function",
      relevantFiles: ["src/middleware/auth.ts"],
      type: "function_lookup",
      difficulty: "easy",
    },
    {
      id: "fl-04",
      query: "where is the database connection pool created",
      relevantFiles: ["src/database/connection.ts"],
      type: "function_lookup",
      difficulty: "easy",
    },
    {
      id: "fl-05",
      query: "function to sanitize user for API response",
      relevantFiles: ["src/models/user.ts"],
      type: "function_lookup",
      difficulty: "medium",
    },
    {
      id: "fl-06",
      query: "where does the product search query get built",
      relevantFiles: ["src/routes/products.ts"],
      type: "function_lookup",
      difficulty: "medium",
    },
    {
      id: "fl-07",
      query: "password comparison function",
      relevantFiles: ["src/utils/crypto.ts"],
      type: "function_lookup",
      difficulty: "easy",
    },
    {
      id: "fl-08",
      query: "generate random token for API keys",
      relevantFiles: ["src/utils/crypto.ts"],
      type: "function_lookup",
      difficulty: "medium",
    },
    {
      id: "fl-09",
      query: "where is the rate limit store defined",
      relevantFiles: ["src/middleware/rateLimit.ts"],
      type: "function_lookup",
      difficulty: "medium",
    },
    {
      id: "fl-10",
      query: "migration runner function",
      relevantFiles: ["src/database/migrations.ts"],
      type: "function_lookup",
      difficulty: "easy",
    },
    {
      id: "fl-11",
      query: "product price formatting function",
      relevantFiles: ["src/models/product.ts"],
      type: "function_lookup",
      difficulty: "medium",
    },
    {
      id: "fl-12",
      query: "where are zod schemas for user input defined",
      relevantFiles: ["src/models/user.ts"],
      type: "function_lookup",
      difficulty: "medium",
    },
    {
      id: "fl-13",
      query: "function to validate password strength",
      relevantFiles: ["src/utils/validation.ts"],
      type: "function_lookup",
      difficulty: "easy",
    },
    {
      id: "fl-14",
      query: "AppError class definition",
      relevantFiles: ["src/middleware/errorHandler.ts"],
      type: "function_lookup",
      difficulty: "easy",
    },
    {
      id: "fl-15",
      query: "child logger creation function",
      relevantFiles: ["src/utils/logger.ts"],
      type: "function_lookup",
      difficulty: "medium",
    },

    // =========================================================================
    // bug_description (10 queries)
    // =========================================================================
    {
      id: "bd-01",
      query: "login fails when email has special characters like quotes",
      relevantFiles: ["src/utils/validation.ts", "src/routes/auth.ts"],
      type: "bug_description",
      difficulty: "medium",
    },
    {
      id: "bd-02",
      query: "rate limiter not resetting after timeout period expires",
      relevantFiles: ["src/middleware/rateLimit.ts"],
      type: "bug_description",
      difficulty: "medium",
    },
    {
      id: "bd-03",
      query: "database connection pool exhaustion under high load",
      relevantFiles: ["src/database/connection.ts"],
      type: "bug_description",
      difficulty: "hard",
    },
    {
      id: "bd-04",
      query: "user can update other users profiles without admin role",
      relevantFiles: ["src/routes/users.ts"],
      type: "bug_description",
      difficulty: "medium",
    },
    {
      id: "bd-05",
      query: "JWT token still valid after logout",
      relevantFiles: ["src/routes/auth.ts", "src/middleware/auth.ts"],
      type: "bug_description",
      difficulty: "hard",
    },
    {
      id: "bd-06",
      query: "product search SQL injection through search parameter",
      relevantFiles: ["src/routes/products.ts"],
      type: "bug_description",
      difficulty: "hard",
    },
    {
      id: "bd-07",
      query: "error handler leaks stack trace in production",
      relevantFiles: ["src/middleware/errorHandler.ts", "src/config/index.ts"],
      type: "bug_description",
      difficulty: "medium",
    },
    {
      id: "bd-08",
      query: "migration rollback does not actually undo DDL changes",
      relevantFiles: ["src/database/migrations.ts"],
      type: "bug_description",
      difficulty: "hard",
    },
    {
      id: "bd-09",
      query: "password hash timing attack vulnerability in login",
      relevantFiles: ["src/utils/crypto.ts", "src/routes/auth.ts"],
      type: "bug_description",
      difficulty: "hard",
    },
    {
      id: "bd-10",
      query: "phone validation accepts invalid short numbers",
      relevantFiles: ["src/utils/validation.ts"],
      type: "bug_description",
      difficulty: "easy",
    },

    // =========================================================================
    // concept_search (15 queries)
    // =========================================================================
    {
      id: "cs-01",
      query: "how does authentication work in this project",
      relevantFiles: ["src/middleware/auth.ts", "src/routes/auth.ts", "src/types/index.ts"],
      type: "concept_search",
      difficulty: "easy",
    },
    {
      id: "cs-02",
      query: "error handling strategy and custom error classes",
      relevantFiles: ["src/middleware/errorHandler.ts"],
      type: "concept_search",
      difficulty: "easy",
    },
    {
      id: "cs-03",
      query: "database connection management and pooling",
      relevantFiles: ["src/database/connection.ts", "src/config/index.ts"],
      type: "concept_search",
      difficulty: "medium",
    },
    {
      id: "cs-04",
      query: "how is rate limiting implemented",
      relevantFiles: ["src/middleware/rateLimit.ts"],
      type: "concept_search",
      difficulty: "easy",
    },
    {
      id: "cs-05",
      query: "user registration and account creation flow",
      relevantFiles: ["src/routes/auth.ts", "src/models/user.ts", "src/utils/crypto.ts"],
      type: "concept_search",
      difficulty: "medium",
    },
    {
      id: "cs-06",
      query: "how does the application validate input data",
      relevantFiles: ["src/utils/validation.ts", "src/models/user.ts", "src/models/product.ts"],
      type: "concept_search",
      difficulty: "medium",
    },
    {
      id: "cs-07",
      query: "logging and observability setup",
      relevantFiles: ["src/utils/logger.ts"],
      type: "concept_search",
      difficulty: "easy",
    },
    {
      id: "cs-08",
      query: "security measures and access control",
      relevantFiles: ["src/middleware/auth.ts", "src/middleware/rateLimit.ts", "src/utils/crypto.ts"],
      type: "concept_search",
      difficulty: "hard",
    },
    {
      id: "cs-09",
      query: "database schema and table definitions",
      relevantFiles: ["src/database/migrations.ts"],
      type: "concept_search",
      difficulty: "medium",
    },
    {
      id: "cs-10",
      query: "how are environment variables and config managed",
      relevantFiles: ["src/config/index.ts"],
      type: "concept_search",
      difficulty: "easy",
    },
    {
      id: "cs-11",
      query: "product catalog features and search capabilities",
      relevantFiles: ["src/routes/products.ts", "src/models/product.ts"],
      type: "concept_search",
      difficulty: "medium",
    },
    {
      id: "cs-12",
      query: "API routing and endpoint organization",
      relevantFiles: ["src/index.ts", "src/routes/users.ts", "src/routes/auth.ts", "src/routes/products.ts"],
      type: "concept_search",
      difficulty: "medium",
    },
    {
      id: "cs-13",
      query: "password security and storage approach",
      relevantFiles: ["src/utils/crypto.ts", "src/models/user.ts"],
      type: "concept_search",
      difficulty: "easy",
    },
    {
      id: "cs-14",
      query: "retry logic and fault tolerance patterns",
      relevantFiles: ["src/database/connection.ts"],
      type: "concept_search",
      difficulty: "hard",
    },
    {
      id: "cs-15",
      query: "type definitions and shared interfaces",
      relevantFiles: ["src/types/index.ts"],
      type: "concept_search",
      difficulty: "easy",
    },

    // =========================================================================
    // cross_file (10 queries)
    // =========================================================================
    {
      id: "xf-01",
      query: "what files import the User model",
      relevantFiles: ["src/routes/users.ts", "src/routes/auth.ts"],
      type: "cross_file",
      difficulty: "medium",
    },
    {
      id: "xf-02",
      query: "files that use the database connection pool",
      relevantFiles: [
        "src/routes/users.ts",
        "src/routes/auth.ts",
        "src/routes/products.ts",
        "src/database/migrations.ts",
        "src/database/connection.ts",
      ],
      type: "cross_file",
      difficulty: "hard",
    },
    {
      id: "xf-03",
      query: "middleware chain for protected routes",
      relevantFiles: ["src/index.ts", "src/middleware/auth.ts", "src/middleware/rateLimit.ts"],
      type: "cross_file",
      difficulty: "hard",
    },
    {
      id: "xf-04",
      query: "where is validateEmail used across the codebase",
      relevantFiles: ["src/utils/validation.ts", "src/routes/users.ts", "src/routes/auth.ts", "src/models/user.ts"],
      type: "cross_file",
      difficulty: "medium",
    },
    {
      id: "xf-05",
      query: "files that import from config module",
      relevantFiles: [
        "src/index.ts",
        "src/routes/auth.ts",
        "src/middleware/auth.ts",
        "src/middleware/rateLimit.ts",
        "src/middleware/errorHandler.ts",
        "src/database/connection.ts",
        "src/utils/logger.ts",
      ],
      type: "cross_file",
      difficulty: "hard",
    },
    {
      id: "xf-06",
      query: "which routes use the logger utility",
      relevantFiles: [
        "src/routes/users.ts",
        "src/routes/auth.ts",
        "src/routes/products.ts",
        "src/utils/logger.ts",
      ],
      type: "cross_file",
      difficulty: "medium",
    },
    {
      id: "xf-07",
      query: "trace the signup flow from route to database",
      relevantFiles: [
        "src/routes/auth.ts",
        "src/utils/validation.ts",
        "src/utils/crypto.ts",
        "src/database/connection.ts",
      ],
      type: "cross_file",
      difficulty: "hard",
    },
    {
      id: "xf-08",
      query: "which modules reference the AuthenticatedRequest type",
      relevantFiles: [
        "src/types/index.ts",
        "src/routes/users.ts",
        "src/routes/products.ts",
        "src/middleware/auth.ts",
      ],
      type: "cross_file",
      difficulty: "medium",
    },
    {
      id: "xf-09",
      query: "all files related to product management",
      relevantFiles: ["src/routes/products.ts", "src/models/product.ts", "src/database/migrations.ts"],
      type: "cross_file",
      difficulty: "medium",
    },
    {
      id: "xf-10",
      query: "files involved in the JWT token lifecycle",
      relevantFiles: ["src/routes/auth.ts", "src/middleware/auth.ts", "src/config/index.ts", "src/types/index.ts"],
      type: "cross_file",
      difficulty: "hard",
    },
  ];
}
