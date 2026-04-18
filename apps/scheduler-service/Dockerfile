# Stage 1: Dependency installation
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy workspace manifests first — Docker caches this layer if nothing changed
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared-kernel/package.json ./packages/shared-kernel/
COPY apps/scheduler-service/package.json ./apps/scheduler-service/

RUN corepack enable pnpm && \
    pnpm install --frozen-lockfile --prefer-offline

# Stage 2: Build
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared-kernel/node_modules ./packages/shared-kernel/node_modules
COPY . .

# Build shared-kernel first (scheduler-service depends on it)
RUN corepack enable pnpm && \
    pnpm --filter "@edgecloud/shared-kernel" build && \
    pnpm --filter "@edgecloud/scheduler-service" build

# Stage 3: Production runtime
FROM node:20-alpine AS runtime

# Security: don't run as root
RUN addgroup -g 1001 edgecloud && \
    adduser -u 1001 -G edgecloud -s /bin/sh -D edgecloud

WORKDIR /app

# Copy only what's needed at runtime
COPY --from=builder --chown=edgecloud:edgecloud /app/packages/shared-kernel/dist ./packages/shared-kernel/dist
COPY --from=builder --chown=edgecloud:edgecloud /app/packages/shared-kernel/package.json ./packages/shared-kernel/
COPY --from=builder --chown=edgecloud:edgecloud /app/apps/scheduler-service/dist ./apps/scheduler-service/dist
COPY --from=builder --chown=edgecloud:edgecloud /app/apps/scheduler-service/package.json ./apps/scheduler-service/

# Install only production dependencies for the final image
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
RUN corepack enable pnpm && \
    pnpm install --frozen-lockfile --prod --prefer-offline && \
    pnpm store prune

USER edgecloud

# Build metadata — accessible at runtime for /version endpoint
ARG BUILD_DATE
ARG GIT_SHA
ENV BUILD_DATE=${BUILD_DATE} \
    GIT_SHA=${GIT_SHA} \
    NODE_ENV=production \
    PORT=3002

EXPOSE 3002 9090

# Healthcheck — used by Docker and Kubernetes before readinessProbe kicks in
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3002/health/live || exit 1

CMD ["node", "apps/scheduler-service/dist/index.js"]
