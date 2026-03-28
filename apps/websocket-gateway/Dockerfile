# WebSocket Gateway Dockerfile
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
COPY apps/websocket-gateway/package.json ./apps/websocket-gateway/
COPY apps/websocket-gateway/tsconfig.json ./apps/websocket-gateway/

# Install dependencies with hoisted node_modules
RUN pnpm install --frozen-lockfile --shamefully-hoist

# Copy source code
COPY packages/shared-kernel ./packages/shared-kernel
COPY packages/event-bus ./packages/event-bus
COPY packages/security ./packages/security
COPY apps/websocket-gateway ./apps/websocket-gateway
COPY tsconfig.json ./

# Build all packages from root using npx with workspace resolution
RUN npx --yes tsc --build packages/shared-kernel
RUN npx --yes tsc --build packages/event-bus
RUN npx --yes tsc --build packages/security
RUN npx --yes tsc --build apps/websocket-gateway

# Production image
FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/packages/shared-kernel/dist ./packages/shared-kernel/dist
COPY --from=builder /app/packages/shared-kernel/package*.json ./packages/shared-kernel/
COPY --from=builder /app/packages/event-bus/dist ./packages/event-bus/dist
COPY --from=builder /app/packages/event-bus/package*.json ./packages/event-bus/
COPY --from=builder /app/packages/security/dist ./packages/security/dist
COPY --from=builder /app/packages/security/package*.json ./packages/security/
COPY --from=builder /app/apps/websocket-gateway/dist ./apps/websocket-gateway/dist
COPY --from=builder /app/apps/websocket-gateway/package*.json ./apps/websocket-gateway/
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

ENV NODE_ENV=production
ENV PORT=3004

EXPOSE 3004

CMD ["node", "apps/websocket-gateway/dist/index.js"]
