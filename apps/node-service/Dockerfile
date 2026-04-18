# Stage 1: Dependency installation
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy workspace manifests
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared-kernel/package.json ./packages/shared-kernel/
COPY packages/event-bus/package.json ./packages/event-bus/
COPY packages/circuit-breaker/package.json ./packages/circuit-breaker/
COPY apps/node-service/package.json ./apps/node-service/

RUN corepack enable pnpm && \
    pnpm install --frozen-lockfile --prefer-offline

# Stage 2: Build
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY . .

RUN corepack enable pnpm && \
    pnpm --filter "@edgecloud/*" build && \
    pnpm --filter "@edgecloud/node-service" build

# Stage 3: Production runtime
FROM node:20-alpine AS runtime

RUN addgroup -g 1001 edgecloud && \
    adduser -u 1001 -G edgecloud -s /bin/sh -D edgecloud

WORKDIR /app

COPY --from=builder --chown=edgecloud:edgecloud /app/packages/shared-kernel/dist ./packages/shared-kernel/dist
COPY --from=builder --chown=edgecloud:edgecloud /app/packages/shared-kernel/package.json ./packages/shared-kernel/
COPY --from=builder --chown=edgecloud:edgecloud /app/packages/event-bus/dist ./packages/event-bus/dist
COPY --from=builder --chown=edgecloud:edgecloud /app/packages/event-bus/package.json ./packages/event-bus/
COPY --from=builder --chown=edgecloud:edgecloud /app/packages/circuit-breaker/dist ./packages/circuit-breaker/dist
COPY --from=builder --chown=edgecloud:edgecloud /app/packages/circuit-breaker/package.json ./packages/circuit-breaker/
COPY --from=builder --chown=edgecloud:edgecloud /app/apps/node-service/dist ./apps/node-service/dist
COPY --from=builder --chown=edgecloud:edgecloud /app/apps/node-service/package.json ./apps/node-service/
COPY --from=builder --chown=edgecloud:edgecloud /app/node_modules ./node_modules

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
RUN corepack enable pnpm && \
    pnpm install --frozen-lockfile --prod --prefer-offline && \
    pnpm store prune

USER edgecloud

ARG BUILD_DATE
ARG GIT_SHA
ENV BUILD_DATE=${BUILD_DATE} \
    GIT_SHA=${GIT_SHA} \
    NODE_ENV=production \
    PORT=3004

EXPOSE 3004 9090

HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3004/health || exit 1

CMD ["node", "apps/node-service/dist/index.js"]
