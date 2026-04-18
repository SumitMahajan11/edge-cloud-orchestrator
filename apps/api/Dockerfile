# Stage 1: Dependency installation
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy workspace manifests
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared-kernel/package.json ./packages/shared-kernel/
COPY packages/circuit-breaker/package.json ./packages/circuit-breaker/
COPY packages/event-bus/package.json ./packages/event-bus/
COPY packages/ml-scheduler/package.json ./packages/ml-scheduler/
COPY packages/outbox/package.json ./packages/outbox/
COPY packages/saga/package.json ./packages/saga/
COPY apps/api/package.json ./apps/api/

RUN corepack enable pnpm && \
    pnpm install --frozen-lockfile --prefer-offline

# Stage 2: Build
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY . .

# Build dependencies and api
RUN corepack enable pnpm && \
    pnpm --filter "@edgecloud/*" build && \
    pnpm --filter "@edgecloud/api" build

# Generate Prisma client
RUN cd apps/api && npx prisma generate

# Stage 3: Production runtime
FROM node:20-alpine AS runtime

RUN addgroup -g 1001 edgecloud && \
    adduser -u 1001 -G edgecloud -s /bin/sh -D edgecloud

WORKDIR /app

# Copy only what's needed at runtime
COPY --from=builder --chown=edgecloud:edgecloud /app/packages/shared-kernel/dist ./packages/shared-kernel/dist
COPY --from=builder --chown=edgecloud:edgecloud /app/packages/shared-kernel/package.json ./packages/shared-kernel/
COPY --from=builder --chown=edgecloud:edgecloud /app/packages/circuit-breaker/dist ./packages/circuit-breaker/dist
COPY --from=builder --chown=edgecloud:edgecloud /app/packages/circuit-breaker/package.json ./packages/circuit-breaker/
COPY --from=builder --chown=edgecloud:edgecloud /app/packages/event-bus/dist ./packages/event-bus/dist
COPY --from=builder --chown=edgecloud:edgecloud /app/packages/event-bus/package.json ./packages/event-bus/
COPY --from=builder --chown=edgecloud:edgecloud /app/packages/ml-scheduler/dist ./packages/ml-scheduler/dist
COPY --from=builder --chown=edgecloud:edgecloud /app/packages/ml-scheduler/package.json ./packages/ml-scheduler/
COPY --from=builder --chown=edgecloud:edgecloud /app/packages/outbox/dist ./packages/outbox/dist
COPY --from=builder --chown=edgecloud:edgecloud /app/packages/outbox/package.json ./packages/outbox/
COPY --from=builder --chown=edgecloud:edgecloud /app/packages/saga/dist ./packages/saga/dist
COPY --from=builder --chown=edgecloud:edgecloud /app/packages/saga/package.json ./packages/saga/
COPY --from=builder --chown=edgecloud:edgecloud /app/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=edgecloud:edgecloud /app/apps/api/package.json ./apps/api/
COPY --from=builder --chown=edgecloud:edgecloud /app/apps/api/prisma ./apps/api/prisma
COPY --from=builder --chown=edgecloud:edgecloud /app/node_modules ./node_modules

# Global configuration
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
RUN corepack enable pnpm && \
    pnpm install --frozen-lockfile --prod --prefer-offline && \
    pnpm store prune

USER edgecloud

# Build metadata
ARG BUILD_DATE
ARG GIT_SHA
ENV BUILD_DATE=${BUILD_DATE} \
    GIT_SHA=${GIT_SHA} \
    NODE_ENV=production \
    PORT=3000

EXPOSE 3000 9090

# Healthcheck
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "apps/api/dist/index.js"]
