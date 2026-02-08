FROM node:20-slim AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@10

# Copy workspace config files first (for layer caching)
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.json ./

# Copy package.json files for dependency resolution
COPY packages/core/package.json packages/core/
COPY packages/nella/package.json packages/nella/

# Hoist all deps so @types/node and tsc resolve correctly
RUN echo "shamefully-hoist=true" > .npmrc

# Install dependencies
RUN pnpm install --frozen-lockfile || pnpm install --no-frozen-lockfile

# Copy source code
COPY packages/core/ packages/core/
COPY packages/nella/ packages/nella/

# Build
ENV PATH="/app/node_modules/.bin:$PATH"
RUN cd packages/core && tsc && cd /app/packages/nella && tsc

# ---- Production stage ----
FROM node:20-slim AS production

WORKDIR /app

RUN npm install -g pnpm@10

# Copy workspace config
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/core/package.json packages/core/
COPY packages/nella/package.json packages/nella/

RUN echo "shamefully-hoist=true" > .npmrc
RUN pnpm install --frozen-lockfile --prod || pnpm install --no-frozen-lockfile --prod

# Copy built output from builder
COPY --from=builder /app/packages/core/dist packages/core/dist
COPY --from=builder /app/packages/nella/dist packages/nella/dist

# Runtime config
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "packages/nella/dist/mcp/hosted-server.js"]
