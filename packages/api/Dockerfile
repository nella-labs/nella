FROM node:20-slim AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

# Copy workspace config files first (for layer caching)
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.json ./

# Copy package.json files for dependency resolution
COPY packages/core/package.json packages/core/
COPY packages/api/package.json packages/api/

# Hoist all deps so @types/node and tsc resolve correctly
RUN echo "shamefully-hoist=true" > .npmrc

# Install dependencies
RUN pnpm install --frozen-lockfile || pnpm install --no-frozen-lockfile

# Copy source code
COPY packages/core/ packages/core/
COPY packages/api/ packages/api/

# Build
ENV PATH="/app/node_modules/.bin:$PATH"
RUN cd packages/core && tsc && cd /app/packages/api && tsc

# ---- Production stage ----
FROM node:20-slim AS production

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

# Copy workspace config
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/core/package.json packages/core/
COPY packages/api/package.json packages/api/

RUN echo "shamefully-hoist=true" > .npmrc
RUN pnpm install --frozen-lockfile --prod || pnpm install --no-frozen-lockfile --prod

# Copy built output from builder
COPY --from=builder /app/packages/core/dist packages/core/dist
COPY --from=builder /app/packages/api/dist packages/api/dist

# Copy api package.json for version reading at runtime
COPY --from=builder /app/packages/api/package.json packages/api/package.json

# Runtime config
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Run as non-root user
RUN addgroup --system app && adduser --system --ingroup app app
USER app

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:8080/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "packages/api/dist/server.js"]
