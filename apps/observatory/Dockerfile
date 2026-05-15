FROM node:22-alpine AS builder
RUN corepack enable
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/observatory/package.json apps/observatory/
RUN pnpm install --frozen-lockfile --filter @irregular/scent-observatory

COPY apps/observatory apps/observatory

# API_BASE and API_KEY are baked in at build time.
# Override with --build-arg if your server is not at localhost:3000.
ARG VITE_API_BASE=http://localhost:3000
ARG VITE_API_KEY=demo-api-key-dev
ENV VITE_API_BASE=$VITE_API_BASE
ENV VITE_API_KEY=$VITE_API_KEY

RUN pnpm --filter @irregular/scent-observatory build

FROM nginx:alpine
COPY --from=builder /app/apps/observatory/dist /usr/share/nginx/html
COPY infra/nginx/observatory.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
