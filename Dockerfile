FROM node:20-slim AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

# Copy workspace config files first (for layer caching)
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.json ./

# Copy package.json files for dependency resolution
COPY packages/core/package.json packages/core/
COPY packages/nella/package.json packages/nella/
COPY packages/benchmark/package.json packages/benchmark/

# Hoist all deps so @types/node and tsc resolve correctly
RUN printf "shamefully-hoist=true\nignore-scripts=true\n" > .npmrc

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/core/ packages/core/
COPY packages/nella/ packages/nella/
COPY packages/benchmark/ packages/benchmark/

# Build
ENV PATH="/app/node_modules/.bin:$PATH"
RUN cd packages/core && tsc && cd /app/packages/nella && tsc && cd /app/packages/benchmark && tsc

# ---- Production stage ----
FROM node:20-slim AS production

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

# Remove npm (and its bundled vulnerable deps) — we only use pnpm
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# Copy workspace config
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/core/package.json packages/core/
COPY packages/nella/package.json packages/nella/

RUN printf "shamefully-hoist=true\nignore-scripts=true\n" > .npmrc
RUN pnpm install --frozen-lockfile --prod

# Remove corepack cache (contains pnpm's bundled deps that trigger Trivy findings)
RUN rm -rf /root/.cache/node/corepack

# Copy built output from builder
COPY --from=builder /app/packages/core/dist packages/core/dist
COPY --from=builder /app/packages/nella/dist packages/nella/dist

# Runtime config
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Run as non-root user
RUN addgroup --system app && adduser --system --ingroup app app
USER app

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "packages/nella/dist/mcp/hosted-server.js"]

# ---- Benchmark stage ----
FROM node:20-slim AS benchmark

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

# Remove npm
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# Copy workspace config
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/core/package.json packages/core/
COPY packages/nella/package.json packages/nella/
COPY packages/benchmark/package.json packages/benchmark/

RUN printf "shamefully-hoist=true\nignore-scripts=true\n" > .npmrc
# Full install (not --prod) because benchmark needs devDeps
RUN pnpm install --frozen-lockfile

# Remove corepack cache
RUN rm -rf /root/.cache/node/corepack

# Copy built output from builder
COPY --from=builder /app/packages/core/dist packages/core/dist
COPY --from=builder /app/packages/nella/dist packages/nella/dist
COPY --from=builder /app/packages/benchmark/dist packages/benchmark/dist

# Runtime config
ENV NODE_ENV=production

# Run as non-root user
RUN addgroup --system app && adduser --system --ingroup app app
USER app

ENTRYPOINT ["node", "packages/benchmark/dist/cli.js"]
