# Stage 1: Builder
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app
RUN corepack enable pnpm

# Copy workspace manifests
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/ ./packages/
COPY apps/web/package.json ./apps/web/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY . .
RUN pnpm --filter "@edgecloud/web" build

# Stage 2: Runner
# Note: apps/web is a Vite app, so we use nginx for minimal footprint
FROM nginx:stable-alpine AS runner

# Create non-root user (nginx image uses 'nginx' user by default, but we'll harden)
# Standard nginx-alpine has nginx user with uid 101

# Copy built assets from builder
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

# Add custom nginx config if needed for SPA routing
# COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
