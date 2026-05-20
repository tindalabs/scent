FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

# Install dependencies using pnpm workspace — only the server + engine packages.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/server/package.json packages/server/
RUN pnpm install --frozen-lockfile --filter @tindalabs/scent-server...

# Build both engine (workspace dep) and server.
FROM deps AS builder
COPY packages/engine packages/engine
COPY packages/server packages/server
RUN pnpm --filter @tindalabs/scent-engine build
RUN pnpm --filter @tindalabs/scent-server build

# Lean runtime image — only compiled JS + SQL migrations.
FROM node:22-alpine AS runner
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/engine ./packages/engine
COPY --from=builder /app/packages/server/dist ./packages/server/dist
COPY --from=builder /app/packages/server/node_modules ./packages/server/node_modules
COPY --from=builder /app/packages/server/package.json ./packages/server/package.json
COPY packages/server/src/db/migrations ./packages/server/dist/db/migrations

ENV NODE_ENV=production
WORKDIR /app/packages/server
EXPOSE 3000

CMD ["node", "--import", "./dist/tracing.js", "dist/index.js"]
