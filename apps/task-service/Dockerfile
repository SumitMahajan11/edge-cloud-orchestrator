# Task Service Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared-kernel/package.json ./packages/shared-kernel/
COPY packages/shared-kernel/tsconfig.json ./packages/shared-kernel/
COPY packages/event-bus/package.json ./packages/event-bus/
COPY packages/event-bus/tsconfig.json ./packages/event-bus/
COPY packages/security/package.json ./packages/security/
COPY packages/security/tsconfig.json ./packages/security/
COPY packages/observability/package.json ./packages/observability/
COPY packages/observability/tsconfig.json ./packages/observability/
COPY packages/performance/package.json ./packages/performance/
COPY packages/performance/tsconfig.json ./packages/performance/
COPY apps/task-service/package.json ./apps/task-service/
COPY apps/task-service/tsconfig.json ./apps/task-service/

# Install dependencies with hoisted node_modules
RUN pnpm install --frozen-lockfile --shamefully-hoist

# Copy source code
COPY packages/shared-kernel ./packages/shared-kernel
COPY packages/event-bus ./packages/event-bus
COPY packages/security ./packages/security
COPY packages/observability ./packages/observability
COPY packages/performance ./packages/performance
COPY apps/task-service ./apps/task-service
COPY tsconfig.json ./

# Build all packages from root using npx with workspace resolution
RUN npx --yes tsc --build packages/shared-kernel
RUN npx --yes tsc --build packages/event-bus
RUN npx --yes tsc --build packages/security
RUN npx --yes tsc --build packages/observability
RUN npx --yes tsc --build packages/performance
RUN npx --yes tsc --build apps/task-service

# Production image
FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/packages/shared-kernel/dist ./packages/shared-kernel/dist
COPY --from=builder /app/packages/shared-kernel/package*.json ./packages/shared-kernel/
COPY --from=builder /app/packages/event-bus/dist ./packages/event-bus/dist
COPY --from=builder /app/packages/event-bus/package*.json ./packages/event-bus/
COPY --from=builder /app/packages/security/dist ./packages/security/dist
COPY --from=builder /app/packages/security/package*.json ./packages/security/
COPY --from=builder /app/packages/observability/dist ./packages/observability/dist
COPY --from=builder /app/packages/observability/package*.json ./packages/observability/
COPY --from=builder /app/packages/performance/dist ./packages/performance/dist
COPY --from=builder /app/packages/performance/package*.json ./packages/performance/
COPY --from=builder /app/apps/task-service/dist ./apps/task-service/dist
COPY --from=builder /app/apps/task-service/package*.json ./apps/task-service/
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD ["node", "apps/task-service/dist/index.js"]
