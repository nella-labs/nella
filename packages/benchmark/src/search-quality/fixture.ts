/**
 * Search Quality Benchmark Fixture
 *
 * A realistic TypeScript REST API project (~20 files) used as the
 * indexing corpus for search quality evaluation. Each file has real
 * imports, exports, and cross-references so the search engine has
 * meaningful structure to work with.
 */

export function getFixtureFiles(): Record<string, string> {
  return {
    "package.json": PACKAGE_JSON,
    "tsconfig.json": TSCONFIG_JSON,
    "src/index.ts": SRC_INDEX,
    "src/routes/users.ts": ROUTES_USERS,
    "src/routes/auth.ts": ROUTES_AUTH,
    "src/routes/products.ts": ROUTES_PRODUCTS,
    "src/middleware/auth.ts": MIDDLEWARE_AUTH,
    "src/middleware/rateLimit.ts": MIDDLEWARE_RATE_LIMIT,
    "src/middleware/errorHandler.ts": MIDDLEWARE_ERROR_HANDLER,
    "src/database/connection.ts": DATABASE_CONNECTION,
    "src/database/migrations.ts": DATABASE_MIGRATIONS,
    "src/models/user.ts": MODELS_USER,
    "src/models/product.ts": MODELS_PRODUCT,
    "src/utils/validation.ts": UTILS_VALIDATION,
    "src/utils/crypto.ts": UTILS_CRYPTO,
    "src/utils/logger.ts": UTILS_LOGGER,
    "src/config/index.ts": CONFIG_INDEX,
    "src/types/index.ts": TYPES_INDEX,
    "tests/auth.test.ts": TESTS_AUTH,
    "tests/users.test.ts": TESTS_USERS,
  };
}

// =============================================================================
// Config Files
// =============================================================================

const PACKAGE_JSON = `{
  "name": "rest-api-fixture",
  "version": "1.0.0",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "ts-node src/index.ts",
    "test": "jest"
  },
  "dependencies": {
    "express": "^4.18.0",
    "jsonwebtoken": "^9.0.0",
    "bcryptjs": "^2.4.3",
    "pg": "^8.11.0",
    "winston": "^3.10.0",
    "express-rate-limit": "^7.1.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.0",
    "@types/jsonwebtoken": "^9.0.0",
    "@types/bcryptjs": "^2.4.0",
    "@types/pg": "^8.10.0",
    "typescript": "^5.3.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.0"
  }
}`;

const TSCONFIG_JSON = `{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}`;

// =============================================================================
// Source Files
// =============================================================================

const SRC_INDEX = `import express from "express";
import { config } from "./config";
import { logger } from "./utils/logger";
import { connectDatabase } from "./database/connection";
import { runMigrations } from "./database/migrations";
import { authRouter } from "./routes/auth";
import { usersRouter } from "./routes/users";
import { productsRouter } from "./routes/products";
import { authMiddleware } from "./middleware/auth";
import { rateLimitMiddleware } from "./middleware/rateLimit";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

const app = express();

// Global middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(rateLimitMiddleware);

// Public routes
app.use("/api/auth", authRouter);

// Protected routes
app.use("/api/users", authMiddleware, usersRouter);
app.use("/api/products", authMiddleware, productsRouter);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

async function bootstrap() {
  try {
    await connectDatabase();
    await runMigrations();

    app.listen(config.port, () => {
      logger.info(\`Server running on port \${config.port}\`);
    });
  } catch (error) {
    logger.error("Failed to start server", { error });
    process.exit(1);
  }
}

bootstrap();

export { app };`;

const ROUTES_USERS = `import { Router, Request, Response } from "express";
import { getPool } from "../database/connection";
import { UserModel, CreateUserInput, UpdateUserInput } from "../models/user";
import { validateEmail, validatePhone } from "../utils/validation";
import { logger } from "../utils/logger";
import type { AuthenticatedRequest } from "../types";

export const usersRouter = Router();

/**
 * GET /api/users — List all users (admin only)
 */
usersRouter.get("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      "SELECT id, email, name, role, created_at FROM users ORDER BY created_at DESC"
    );
    res.json({ users: rows });
  } catch (error) {
    logger.error("Failed to list users", { error });
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/users/:id — Get user by ID
 */
usersRouter.get("/:id", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      "SELECT id, email, name, role, created_at FROM users WHERE id = $1",
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ user: rows[0] });
  } catch (error) {
    logger.error("Failed to get user", { error, userId: req.params.id });
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PUT /api/users/:id — Update user profile
 */
usersRouter.put("/:id", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { email, name, phone } = req.body as UpdateUserInput;

    // Validate fields if provided
    if (email && !validateEmail(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }
    if (phone && !validatePhone(phone)) {
      return res.status(400).json({ error: "Invalid phone format" });
    }

    // Only allow users to update their own profile
    if (req.user?.id !== req.params.id && req.user?.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const pool = getPool();
    const fields: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (email) { fields.push(\`email = $\${paramIndex++}\`); values.push(email); }
    if (name) { fields.push(\`name = $\${paramIndex++}\`); values.push(name); }
    if (phone) { fields.push(\`phone = $\${paramIndex++}\`); values.push(phone); }

    if (fields.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    values.push(req.params.id);
    const { rows } = await pool.query(
      \`UPDATE users SET \${fields.join(", ")} WHERE id = $\${paramIndex} RETURNING id, email, name, role\`,
      values
    );

    res.json({ user: rows[0] });
  } catch (error) {
    logger.error("Failed to update user", { error, userId: req.params.id });
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * DELETE /api/users/:id — Delete user (admin only)
 */
usersRouter.delete("/:id", async (req: AuthenticatedRequest, res: Response) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }

  try {
    const pool = getPool();
    await pool.query("DELETE FROM users WHERE id = $1", [req.params.id]);
    res.json({ message: "User deleted" });
  } catch (error) {
    logger.error("Failed to delete user", { error, userId: req.params.id });
    res.status(500).json({ error: "Internal server error" });
  }
});`;

const ROUTES_AUTH = `import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { getPool } from "../database/connection";
import { UserModel, CreateUserInput } from "../models/user";
import { hashPassword, comparePassword } from "../utils/crypto";
import { validateEmail } from "../utils/validation";
import { config } from "../config";
import { logger } from "../utils/logger";
import type { JwtPayload } from "../types";

export const authRouter = Router();

/**
 * POST /api/auth/signup — Register a new user
 */
authRouter.post("/signup", async (req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body as CreateUserInput & { password: string };

    if (!email || !password || !name) {
      return res.status(400).json({ error: "Email, password, and name are required" });
    }

    if (!validateEmail(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    // Check if email already exists
    const pool = getPool();
    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "Email already registered" });
    }

    // Hash password and create user
    const passwordHash = await hashPassword(password);
    const { rows } = await pool.query(
      "INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4) RETURNING id, email, name, role",
      [email, passwordHash, name, "user"]
    );

    const user = rows[0];
    const token = generateToken({ userId: user.id, email: user.email, role: user.role });

    logger.info("User signed up", { userId: user.id, email: user.email });
    res.status(201).json({ user, token });
  } catch (error) {
    logger.error("Signup failed", { error });
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/auth/login — Authenticate user and return JWT
 */
authRouter.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const pool = getPool();
    const { rows } = await pool.query(
      "SELECT id, email, name, role, password_hash FROM users WHERE email = $1",
      [email]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const user = rows[0];
    const passwordValid = await comparePassword(password, user.password_hash);
    if (!passwordValid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = generateToken({ userId: user.id, email: user.email, role: user.role });

    logger.info("User logged in", { userId: user.id });
    res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role }, token });
  } catch (error) {
    logger.error("Login failed", { error });
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/auth/logout — Invalidate session (client-side token removal)
 */
authRouter.post("/logout", (_req: Request, res: Response) => {
  // JWT is stateless — logout is handled client-side by removing the token.
  // A production system would add the token to a blocklist.
  res.json({ message: "Logged out successfully" });
});

/**
 * POST /api/auth/refresh — Refresh an expired JWT token
 */
authRouter.post("/refresh", async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "No token provided" });
    }

    const oldToken = authHeader.slice(7);
    const decoded = jwt.verify(oldToken, config.jwtSecret, { ignoreExpiration: true }) as JwtPayload;

    const token = generateToken({ userId: decoded.userId, email: decoded.email, role: decoded.role });
    res.json({ token });
  } catch (error) {
    logger.error("Token refresh failed", { error });
    res.status(401).json({ error: "Invalid token" });
  }
});

function generateToken(payload: JwtPayload): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}`;

const ROUTES_PRODUCTS = `import { Router, Request, Response } from "express";
import { getPool } from "../database/connection";
import { ProductModel, CreateProductInput, ProductSearchParams } from "../models/product";
import { logger } from "../utils/logger";
import type { AuthenticatedRequest } from "../types";

export const productsRouter = Router();

/**
 * GET /api/products — List products with pagination and search
 */
productsRouter.get("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { search, category, minPrice, maxPrice, page = "1", limit = "20" } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    const pool = getPool();
    let query = "SELECT * FROM products WHERE 1=1";
    const params: unknown[] = [];
    let paramIndex = 1;

    if (search) {
      query += \` AND (name ILIKE $\${paramIndex} OR description ILIKE $\${paramIndex})\`;
      params.push(\`%\${search}%\`);
      paramIndex++;
    }

    if (category) {
      query += \` AND category = $\${paramIndex}\`;
      params.push(category);
      paramIndex++;
    }

    if (minPrice) {
      query += \` AND price >= $\${paramIndex}\`;
      params.push(Number(minPrice));
      paramIndex++;
    }

    if (maxPrice) {
      query += \` AND price <= $\${paramIndex}\`;
      params.push(Number(maxPrice));
      paramIndex++;
    }

    // Count total for pagination
    const countResult = await pool.query(
      query.replace("SELECT *", "SELECT COUNT(*)"),
      params
    );
    const total = Number(countResult.rows[0].count);

    // Fetch page
    query += \` ORDER BY created_at DESC LIMIT $\${paramIndex} OFFSET $\${paramIndex + 1}\`;
    params.push(Number(limit), offset);

    const { rows } = await pool.query(query, params);

    res.json({
      products: rows,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    logger.error("Failed to list products", { error });
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/products/:id — Get product by ID
 */
productsRouter.get("/:id", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query("SELECT * FROM products WHERE id = $1", [req.params.id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: "Product not found" });
    }

    res.json({ product: rows[0] });
  } catch (error) {
    logger.error("Failed to get product", { error, productId: req.params.id });
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/products — Create a new product (admin only)
 */
productsRouter.post("/", async (req: AuthenticatedRequest, res: Response) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }

  try {
    const { name, description, price, category, stock } = req.body as CreateProductInput;

    if (!name || price == null) {
      return res.status(400).json({ error: "Name and price are required" });
    }

    const pool = getPool();
    const { rows } = await pool.query(
      "INSERT INTO products (name, description, price, category, stock) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [name, description || "", price, category || "uncategorized", stock || 0]
    );

    logger.info("Product created", { productId: rows[0].id });
    res.status(201).json({ product: rows[0] });
  } catch (error) {
    logger.error("Failed to create product", { error });
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * DELETE /api/products/:id — Delete product (admin only)
 */
productsRouter.delete("/:id", async (req: AuthenticatedRequest, res: Response) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }

  try {
    const pool = getPool();
    const result = await pool.query("DELETE FROM products WHERE id = $1", [req.params.id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Product not found" });
    }

    res.json({ message: "Product deleted" });
  } catch (error) {
    logger.error("Failed to delete product", { error, productId: req.params.id });
    res.status(500).json({ error: "Internal server error" });
  }
});`;

const MIDDLEWARE_AUTH = `import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { logger } from "../utils/logger";
import type { AuthenticatedRequest, JwtPayload } from "../types";

/**
 * JWT Authentication Middleware
 *
 * Verifies the Bearer token from the Authorization header,
 * decodes the JWT payload, and attaches the user to the request.
 * Returns 401 if the token is missing, expired, or invalid.
 */
export function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as JwtPayload;
    req.user = {
      id: decoded.userId,
      email: decoded.email,
      role: decoded.role,
    };
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      logger.warn("Expired token used", { error });
      res.status(401).json({ error: "Token expired" });
      return;
    }

    logger.warn("Invalid token", { error });
    res.status(401).json({ error: "Invalid token" });
  }
}

/**
 * Role-based authorization middleware factory.
 * Returns middleware that checks if the authenticated user has
 * one of the specified roles.
 */
export function requireRole(...roles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }

    next();
  };
}`;

const MIDDLEWARE_RATE_LIMIT = `import { Request, Response, NextFunction } from "express";
import { config } from "../config";
import { logger } from "../utils/logger";

/**
 * In-memory rate limiter using a sliding window approach.
 *
 * Tracks request counts per IP in a Map. Each entry stores
 * timestamps of recent requests. Expired entries are cleaned
 * up periodically to prevent memory leaks.
 *
 * For production, replace with Redis-backed rate limiting.
 */

interface RateLimitEntry {
  timestamps: number[];
  blocked: boolean;
  blockedUntil: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Cleanup interval: remove expired entries every 60 seconds
const CLEANUP_INTERVAL_MS = 60_000;
let cleanupTimer: NodeJS.Timeout | null = null;

function startCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of rateLimitStore) {
      // Remove timestamps older than the window
      entry.timestamps = entry.timestamps.filter(
        (t) => now - t < config.rateLimitWindowMs
      );
      // Unblock if block period expired
      if (entry.blocked && now > entry.blockedUntil) {
        entry.blocked = false;
      }
      // Remove empty entries
      if (entry.timestamps.length === 0 && !entry.blocked) {
        rateLimitStore.delete(ip);
      }
    }
  }, CLEANUP_INTERVAL_MS);
}

/**
 * Rate limiting middleware.
 *
 * Limits each IP to config.rateLimitMax requests per
 * config.rateLimitWindowMs window. Blocked IPs receive
 * 429 Too Many Requests until the window expires.
 */
export function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  startCleanup();

  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();

  let entry = rateLimitStore.get(ip);
  if (!entry) {
    entry = { timestamps: [], blocked: false, blockedUntil: 0 };
    rateLimitStore.set(ip, entry);
  }

  // Check if currently blocked
  if (entry.blocked && now < entry.blockedUntil) {
    const retryAfter = Math.ceil((entry.blockedUntil - now) / 1000);
    res.set("Retry-After", String(retryAfter));
    res.status(429).json({
      error: "Too many requests",
      retryAfter,
    });
    return;
  }

  // Unblock if block period has passed
  if (entry.blocked && now >= entry.blockedUntil) {
    entry.blocked = false;
    entry.timestamps = [];
  }

  // Clean old timestamps outside window
  entry.timestamps = entry.timestamps.filter(
    (t) => now - t < config.rateLimitWindowMs
  );

  // Check if over limit
  if (entry.timestamps.length >= config.rateLimitMax) {
    entry.blocked = true;
    entry.blockedUntil = now + config.rateLimitWindowMs;
    logger.warn("Rate limit exceeded", { ip, count: entry.timestamps.length });

    const retryAfter = Math.ceil(config.rateLimitWindowMs / 1000);
    res.set("Retry-After", String(retryAfter));
    res.status(429).json({
      error: "Too many requests",
      retryAfter,
    });
    return;
  }

  entry.timestamps.push(now);
  next();
}

/**
 * Reset the rate limit store (for testing)
 */
export function resetRateLimiter(): void {
  rateLimitStore.clear();
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}`;

const MIDDLEWARE_ERROR_HANDLER = `import { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";
import { config } from "../config";

/**
 * Application error with HTTP status code.
 */
export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code?: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

/**
 * Validation error for request body issues.
 */
export class ValidationError extends AppError {
  constructor(
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message, 400, "VALIDATION_ERROR");
    this.name = "ValidationError";
  }
}

/**
 * Global error handler middleware.
 *
 * Catches all unhandled errors, logs them, and returns a
 * structured JSON response. In development mode, includes
 * the error stack trace for debugging.
 */
export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  // Log the error
  logger.error("Unhandled error", {
    error: err.message,
    stack: err.stack,
    name: err.name,
  });

  // Determine status code
  const statusCode = err instanceof AppError ? err.statusCode : 500;
  const code = err instanceof AppError ? err.code : "INTERNAL_ERROR";

  // Build response
  const response: Record<string, unknown> = {
    error: err.message || "Internal server error",
    code,
  };

  // Include validation fields if present
  if (err instanceof ValidationError) {
    response.fields = err.fields;
  }

  // Include stack in development
  if (config.nodeEnv === "development") {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
}

/**
 * 404 handler for unmatched routes.
 */
export function notFoundHandler(req: Request, res: Response, _next: NextFunction): void {
  res.status(404).json({
    error: "Not found",
    path: req.originalUrl,
  });
}`;

const DATABASE_CONNECTION = `import { Pool, PoolConfig } from "pg";
import { config } from "../config";
import { logger } from "../utils/logger";

/**
 * Database Connection Pool
 *
 * Manages a PostgreSQL connection pool with configurable
 * size, timeouts, and automatic reconnection. Uses pg Pool
 * for efficient connection reuse across requests.
 */

let pool: Pool | null = null;

/**
 * Initialize and return the database connection pool.
 * Creates the pool on first call, returns existing on subsequent calls.
 */
export async function connectDatabase(): Promise<Pool> {
  if (pool) return pool;

  const poolConfig: PoolConfig = {
    connectionString: config.databaseUrl,
    max: config.dbPoolMax,
    idleTimeoutMillis: config.dbIdleTimeout,
    connectionTimeoutMillis: config.dbConnectionTimeout,
  };

  pool = new Pool(poolConfig);

  // Handle pool errors
  pool.on("error", (err) => {
    logger.error("Unexpected database pool error", { error: err.message });
  });

  // Test connection
  try {
    const client = await pool.connect();
    await client.query("SELECT 1");
    client.release();
    logger.info("Database connected", {
      host: new URL(config.databaseUrl).hostname,
      maxConnections: config.dbPoolMax,
    });
  } catch (error) {
    logger.error("Database connection failed", { error });
    pool = null;
    throw error;
  }

  return pool;
}

/**
 * Get the active connection pool.
 * Throws if the pool hasn't been initialized.
 */
export function getPool(): Pool {
  if (!pool) {
    throw new Error("Database pool not initialized. Call connectDatabase() first.");
  }
  return pool;
}

/**
 * Close the database connection pool gracefully.
 * Waits for active queries to complete before closing.
 */
export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info("Database connection closed");
  }
}

/**
 * Execute a query with automatic retry for transient failures.
 * Retries up to 3 times with exponential backoff for connection errors.
 */
export async function queryWithRetry<T>(
  sql: string,
  params?: unknown[],
  retries: number = 3,
): Promise<T[]> {
  const p = getPool();

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await p.query(sql, params);
      return result.rows as T[];
    } catch (error: unknown) {
      const isTransient = error instanceof Error &&
        (error.message.includes("ECONNREFUSED") ||
         error.message.includes("connection terminated") ||
         error.message.includes("too many clients"));

      if (isTransient && attempt < retries) {
        const delay = Math.pow(2, attempt) * 100;
        logger.warn(\`Query retry \${attempt}/\${retries} after \${delay}ms\`, { error });
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      throw error;
    }
  }

  return [];
}`;

const DATABASE_MIGRATIONS = `import { getPool } from "./connection";
import { logger } from "../utils/logger";

/**
 * Database Migration Runner
 *
 * Runs SQL migrations in order. Tracks applied migrations
 * in a migrations table to prevent re-running.
 */

interface Migration {
  id: number;
  name: string;
  sql: string;
}

const migrations: Migration[] = [
  {
    id: 1,
    name: "create_users_table",
    sql: \`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        phone VARCHAR(50),
        role VARCHAR(50) DEFAULT 'user',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    \`,
  },
  {
    id: 2,
    name: "create_products_table",
    sql: \`
      CREATE TABLE IF NOT EXISTS products (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        description TEXT,
        price DECIMAL(10, 2) NOT NULL,
        category VARCHAR(100) DEFAULT 'uncategorized',
        stock INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
      CREATE INDEX IF NOT EXISTS idx_products_price ON products(price);
    \`,
  },
  {
    id: 3,
    name: "create_sessions_table",
    sql: \`
      CREATE TABLE IF NOT EXISTS sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        token_hash VARCHAR(255) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
    \`,
  },
];

/**
 * Run all pending migrations.
 * Creates the migrations tracking table if it doesn't exist.
 */
export async function runMigrations(): Promise<void> {
  const pool = getPool();

  // Create migrations tracking table
  await pool.query(\`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      applied_at TIMESTAMP DEFAULT NOW()
    )
  \`);

  // Get applied migrations
  const { rows: applied } = await pool.query("SELECT id FROM _migrations ORDER BY id");
  const appliedIds = new Set(applied.map((r: { id: number }) => r.id));

  // Run pending migrations
  for (const migration of migrations) {
    if (appliedIds.has(migration.id)) {
      continue;
    }

    logger.info(\`Running migration: \${migration.name}\`);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(migration.sql);
      await client.query(
        "INSERT INTO _migrations (id, name) VALUES ($1, $2)",
        [migration.id, migration.name]
      );
      await client.query("COMMIT");
      logger.info(\`Migration applied: \${migration.name}\`);
    } catch (error) {
      await client.query("ROLLBACK");
      logger.error(\`Migration failed: \${migration.name}\`, { error });
      throw error;
    } finally {
      client.release();
    }
  }
}

/**
 * Rollback the last applied migration (for development).
 */
export async function rollbackLastMigration(): Promise<void> {
  const pool = getPool();

  const { rows } = await pool.query(
    "SELECT id, name FROM _migrations ORDER BY id DESC LIMIT 1"
  );

  if (rows.length === 0) {
    logger.info("No migrations to rollback");
    return;
  }

  const last = rows[0];
  logger.info(\`Rolling back migration: \${last.name}\`);
  await pool.query("DELETE FROM _migrations WHERE id = $1", [last.id]);
  logger.info(\`Rollback complete: \${last.name}\`);
}`;

const MODELS_USER = `import { z } from "zod";
import { validateEmail, validatePhone } from "../utils/validation";

/**
 * User Model
 *
 * Defines the User type, input validation schemas, and
 * utility functions for working with user records.
 */

export interface UserModel {
  id: string;
  email: string;
  name: string;
  phone?: string;
  role: "user" | "admin";
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

export const CreateUserSchema = z.object({
  email: z.string().email("Invalid email address").max(255),
  name: z.string().min(1, "Name is required").max(255),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
  phone: z.string().optional(),
});

export type CreateUserInput = z.infer<typeof CreateUserSchema>;

export const UpdateUserSchema = z.object({
  email: z.string().email().max(255).optional(),
  name: z.string().min(1).max(255).optional(),
  phone: z.string().optional(),
});

export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;

/**
 * Validate a CreateUserInput, returning null on success
 * or an error message on failure.
 */
export function validateCreateUser(input: unknown): string | null {
  const result = CreateUserSchema.safeParse(input);
  if (!result.success) {
    return result.error.issues.map((i) => i.message).join(", ");
  }

  // Additional custom validations
  if (!validateEmail(result.data.email)) {
    return "Email format is invalid";
  }

  if (result.data.phone && !validatePhone(result.data.phone)) {
    return "Phone format is invalid";
  }

  return null;
}

/**
 * Sanitize user record for API responses (strip sensitive fields).
 */
export function sanitizeUser(user: UserModel): Omit<UserModel, "passwordHash"> {
  const { passwordHash, ...safe } = user;
  return safe;
}

/**
 * Check if a user has admin privileges.
 */
export function isAdmin(user: Pick<UserModel, "role">): boolean {
  return user.role === "admin";
}`;

const MODELS_PRODUCT = `import { z } from "zod";

/**
 * Product Model
 *
 * Defines the Product type, validation schemas, and
 * product search parameter types.
 */

export interface ProductModel {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  stock: number;
  createdAt: Date;
  updatedAt: Date;
}

export const CreateProductSchema = z.object({
  name: z.string().min(1, "Product name is required").max(255),
  description: z.string().max(5000).optional(),
  price: z.number().positive("Price must be positive").max(999999.99),
  category: z.string().max(100).optional(),
  stock: z.number().int().min(0).optional(),
});

export type CreateProductInput = z.infer<typeof CreateProductSchema>;

export const UpdateProductSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(5000).optional(),
  price: z.number().positive().max(999999.99).optional(),
  category: z.string().max(100).optional(),
  stock: z.number().int().min(0).optional(),
});

export type UpdateProductInput = z.infer<typeof UpdateProductSchema>;

export interface ProductSearchParams {
  search?: string;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  page?: number;
  limit?: number;
  sortBy?: "price" | "name" | "created_at";
  sortOrder?: "asc" | "desc";
}

/**
 * Validate product creation input.
 */
export function validateCreateProduct(input: unknown): string | null {
  const result = CreateProductSchema.safeParse(input);
  if (!result.success) {
    return result.error.issues.map((i) => i.message).join(", ");
  }
  return null;
}

/**
 * Format price for display (e.g., "$12.99").
 */
export function formatPrice(price: number): string {
  return \`$\${price.toFixed(2)}\`;
}

/**
 * Check if a product is in stock.
 */
export function isInStock(product: Pick<ProductModel, "stock">): boolean {
  return product.stock > 0;
}

/**
 * Calculate discounted price.
 */
export function applyDiscount(price: number, discountPercent: number): number {
  if (discountPercent < 0 || discountPercent > 100) {
    throw new Error("Discount must be between 0 and 100");
  }
  return Math.round(price * (1 - discountPercent / 100) * 100) / 100;
}`;

const UTILS_VALIDATION = `/**
 * Validation Utilities
 *
 * Email, phone, and other input validation helpers.
 * Used across routes and models for consistent validation.
 */

/**
 * Validate an email address format.
 *
 * Uses a practical regex that covers most real-world email formats.
 * Does NOT validate RFC 5322 fully — that would require a parser.
 * Handles common cases: user@domain.com, user+tag@domain.co.uk
 *
 * Note: emails with special characters like quotes or parentheses
 * in the local part are technically valid per RFC but rejected here
 * for practical security reasons.
 */
export function validateEmail(email: string): boolean {
  if (!email || email.length > 254) return false;

  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email);
}

/**
 * Validate a phone number format.
 *
 * Accepts international and US formats:
 * +1234567890, (123) 456-7890, 123-456-7890, +1 (123) 456-7890
 */
export function validatePhone(phone: string): boolean {
  if (!phone || phone.length > 20) return false;

  const phoneRegex = /^[+]?[(]?[0-9]{1,4}[)]?[-\\s./0-9]*$/;
  return phoneRegex.test(phone) && phone.replace(/\\D/g, "").length >= 7;
}

/**
 * Validate a UUID v4 format.
 */
export function validateUuid(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

/**
 * Sanitize a string for safe database use.
 * Strips null bytes and trims whitespace.
 */
export function sanitizeString(input: string): string {
  return input.replace(/\\0/g, "").trim();
}

/**
 * Validate password strength.
 * Requires: 8+ chars, at least one uppercase, one lowercase, one digit.
 */
export function validatePasswordStrength(password: string): {
  valid: boolean;
  reason?: string;
} {
  if (password.length < 8) {
    return { valid: false, reason: "Password must be at least 8 characters" };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, reason: "Password must contain an uppercase letter" };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, reason: "Password must contain a lowercase letter" };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, reason: "Password must contain a digit" };
  }
  return { valid: true };
}`;

const UTILS_CRYPTO = `import bcrypt from "bcryptjs";

/**
 * Cryptographic Utilities
 *
 * Password hashing and comparison using bcrypt.
 * Salt rounds are tuned for a balance between security
 * and performance (~100ms per hash on modern hardware).
 */

const SALT_ROUNDS = 12;

/**
 * Hash a plaintext password using bcrypt.
 *
 * @param password  The plaintext password to hash
 * @returns The bcrypt hash string
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(SALT_ROUNDS);
  return bcrypt.hash(password, salt);
}

/**
 * Compare a plaintext password against a bcrypt hash.
 *
 * @param password  The plaintext password to check
 * @param hash      The bcrypt hash to compare against
 * @returns True if the password matches
 */
export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Generate a random token string for API keys, reset tokens, etc.
 *
 * @param length  Number of random bytes (default: 32, produces 64 hex chars)
 * @returns Hex-encoded random token
 */
export function generateRandomToken(length: number = 32): string {
  const crypto = require("crypto");
  return crypto.randomBytes(length).toString("hex");
}

/**
 * Hash a token for safe storage (e.g., password reset tokens).
 * Uses SHA-256 since these are already high-entropy random values.
 */
export function hashToken(token: string): string {
  const crypto = require("crypto");
  return crypto.createHash("sha256").update(token).digest("hex");
}`;

const UTILS_LOGGER = `import winston from "winston";
import { config } from "../config";

/**
 * Application Logger
 *
 * Centralized logging using Winston. Supports JSON format
 * for production (structured logging) and colorized console
 * output for development.
 */

const logFormat = config.nodeEnv === "production"
  ? winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json(),
    )
  : winston.format.combine(
      winston.format.timestamp({ format: "HH:mm:ss" }),
      winston.format.colorize(),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : "";
        return \`\${timestamp} \${level}: \${message} \${metaStr}\`;
      }),
    );

export const logger = winston.createLogger({
  level: config.logLevel,
  format: logFormat,
  transports: [
    new winston.transports.Console(),
  ],
  // Don't exit on uncaught errors
  exitOnError: false,
});

/**
 * Create a child logger with a specific context (e.g., request ID).
 */
export function createChildLogger(context: Record<string, string>): winston.Logger {
  return logger.child(context);
}

/**
 * Log an HTTP request for audit purposes.
 */
export function logRequest(method: string, path: string, statusCode: number, durationMs: number): void {
  logger.info("HTTP request", {
    method,
    path,
    statusCode,
    durationMs,
  });
}`;

const CONFIG_INDEX = `/**
 * Application Configuration
 *
 * Loads and validates environment variables. Provides typed
 * access to all configuration values with sensible defaults.
 */

export interface AppConfig {
  port: number;
  nodeEnv: string;
  databaseUrl: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  logLevel: string;
  rateLimitMax: number;
  rateLimitWindowMs: number;
  dbPoolMax: number;
  dbIdleTimeout: number;
  dbConnectionTimeout: number;
  corsOrigin: string;
}

function loadConfig(): AppConfig {
  const required = (key: string): string => {
    const value = process.env[key];
    if (!value) {
      throw new Error(\`Missing required environment variable: \${key}\`);
    }
    return value;
  };

  const optional = (key: string, fallback: string): string => {
    return process.env[key] || fallback;
  };

  return {
    port: Number(optional("PORT", "3000")),
    nodeEnv: optional("NODE_ENV", "development"),
    databaseUrl: required("DATABASE_URL"),
    jwtSecret: required("JWT_SECRET"),
    jwtExpiresIn: optional("JWT_EXPIRES_IN", "24h"),
    logLevel: optional("LOG_LEVEL", "info"),
    rateLimitMax: Number(optional("RATE_LIMIT_MAX", "100")),
    rateLimitWindowMs: Number(optional("RATE_LIMIT_WINDOW_MS", "900000")),
    dbPoolMax: Number(optional("DB_POOL_MAX", "20")),
    dbIdleTimeout: Number(optional("DB_IDLE_TIMEOUT", "30000")),
    dbConnectionTimeout: Number(optional("DB_CONNECTION_TIMEOUT", "5000")),
    corsOrigin: optional("CORS_ORIGIN", "*"),
  };
}

export const config = loadConfig();`;

const TYPES_INDEX = `import { Request } from "express";

/**
 * Shared Type Definitions
 *
 * Types used across multiple modules in the application.
 */

/**
 * JWT token payload structure.
 */
export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}

/**
 * Express Request with authenticated user attached.
 */
export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
  };
}

/**
 * Standard API error response.
 */
export interface ApiError {
  error: string;
  code?: string;
  fields?: Record<string, string>;
  stack?: string;
}

/**
 * Paginated response wrapper.
 */
export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Database row timestamps.
 */
export interface Timestamps {
  createdAt: Date;
  updatedAt: Date;
}`;

// =============================================================================
// Test Files
// =============================================================================

const TESTS_AUTH = `import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";

/**
 * Auth Route Tests
 *
 * Tests for signup, login, logout, and token refresh endpoints.
 */

describe("Auth Routes", () => {
  describe("POST /api/auth/signup", () => {
    it("should create a new user with valid input", async () => {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "test@example.com",
          password: "StrongPass123",
          name: "Test User",
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.user).toBeDefined();
      expect(body.token).toBeDefined();
      expect(body.user.email).toBe("test@example.com");
    });

    it("should reject invalid email format", async () => {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "not-an-email",
          password: "StrongPass123",
          name: "Test",
        }),
      });

      expect(response.status).toBe(400);
    });

    it("should reject short passwords", async () => {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "test2@example.com",
          password: "short",
          name: "Test",
        }),
      });

      expect(response.status).toBe(400);
    });

    it("should reject duplicate email", async () => {
      // First signup
      await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "dupe@example.com",
          password: "StrongPass123",
          name: "First",
        }),
      });

      // Duplicate signup
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "dupe@example.com",
          password: "StrongPass123",
          name: "Second",
        }),
      });

      expect(response.status).toBe(409);
    });
  });

  describe("POST /api/auth/login", () => {
    it("should return token for valid credentials", async () => {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "test@example.com",
          password: "StrongPass123",
        }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.token).toBeDefined();
    });

    it("should reject invalid password", async () => {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "test@example.com",
          password: "WrongPassword",
        }),
      });

      expect(response.status).toBe(401);
    });
  });

  describe("POST /api/auth/logout", () => {
    it("should return success message", async () => {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
      });

      expect(response.status).toBe(200);
    });
  });
});`;

const TESTS_USERS = `import { describe, it, expect, beforeAll } from "@jest/globals";

/**
 * User Route Tests
 *
 * Tests for CRUD operations on user profiles.
 * Requires authentication — uses a setup step to get a token.
 */

let authToken: string;
let userId: string;

describe("User Routes", () => {
  beforeAll(async () => {
    // Create a test user and get token
    const signup = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "usertest@example.com",
        password: "StrongPass123",
        name: "User Test",
      }),
    });
    const body = await signup.json();
    authToken = body.token;
    userId = body.user.id;
  });

  describe("GET /api/users", () => {
    it("should list users with auth token", async () => {
      const response = await fetch("/api/users", {
        headers: { Authorization: \`Bearer \${authToken}\` },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.users).toBeInstanceOf(Array);
    });

    it("should reject unauthenticated requests", async () => {
      const response = await fetch("/api/users");
      expect(response.status).toBe(401);
    });
  });

  describe("GET /api/users/:id", () => {
    it("should return user by ID", async () => {
      const response = await fetch(\`/api/users/\${userId}\`, {
        headers: { Authorization: \`Bearer \${authToken}\` },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.user.email).toBe("usertest@example.com");
    });

    it("should return 404 for non-existent user", async () => {
      const response = await fetch("/api/users/00000000-0000-4000-a000-000000000000", {
        headers: { Authorization: \`Bearer \${authToken}\` },
      });

      expect(response.status).toBe(404);
    });
  });

  describe("PUT /api/users/:id", () => {
    it("should update user profile", async () => {
      const response = await fetch(\`/api/users/\${userId}\`, {
        method: "PUT",
        headers: {
          Authorization: \`Bearer \${authToken}\`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "Updated Name" }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.user.name).toBe("Updated Name");
    });

    it("should reject invalid email in update", async () => {
      const response = await fetch(\`/api/users/\${userId}\`, {
        method: "PUT",
        headers: {
          Authorization: \`Bearer \${authToken}\`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: "bad-email" }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe("DELETE /api/users/:id", () => {
    it("should reject non-admin delete", async () => {
      const response = await fetch(\`/api/users/\${userId}\`, {
        method: "DELETE",
        headers: { Authorization: \`Bearer \${authToken}\` },
      });

      expect(response.status).toBe(403);
    });
  });
});`;
