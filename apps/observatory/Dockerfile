FROM node:22-alpine AS builder
RUN corepack enable
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/observatory/package.json apps/observatory/
RUN pnpm install --frozen-lockfile --filter @tindalabs/scent-observatory

COPY apps/observatory apps/observatory

# The API base URL is baked in at build time. Override with --build-arg if your
# server is not at localhost:3000. Data access is authorized at runtime by the admin
# session cookie + the selected project (X-Project-Id) — there is no build-time key.
ARG VITE_API_BASE=http://localhost:3000
ENV VITE_API_BASE=$VITE_API_BASE

RUN pnpm --filter @tindalabs/scent-observatory build

FROM nginx:alpine
COPY --from=builder /app/apps/observatory/dist /usr/share/nginx/html
COPY infra/nginx/observatory.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
