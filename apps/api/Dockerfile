# Stage 1: Builder
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

ENV PNPM_CONFIG_IGNORE_SCRIPTS=true
ENV PNPM_CONFIG_FETCH_RETRIES=5
ENV PNPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000
ENV PNPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000
ENV PNPM_CONFIG_NETWORK_TIMEOUT=300000

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

# Copy all files
COPY . .

# Install ONLY backend dependencies (frozen lockfile for reproducibility) using buildkit cache
RUN pnpm install --filter=@edgecloud/api... --no-frozen-lockfile --ignore-scripts

# Generate Prisma client for typescript compilation in builder stage
RUN cd apps/api && pnpm exec prisma generate

# Build the application
RUN pnpm --filter "@edgecloud/api..." build

# Deploy isolated production application to /deploy
RUN pnpm --filter=@edgecloud/api --prod deploy /deploy

# Copy Prisma schema into deploy folder and regenerate the client there directly,
# so it resolves correctly relative to /deploy/node_modules at runtime
RUN cp -r apps/api/prisma /deploy/prisma
RUN cd /deploy && /app/node_modules/.bin/prisma generate --schema=./prisma/schema.prisma

# Stage 2: Runner
FROM node:22-alpine AS runner
RUN apk add --no-cache openssl
WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000

# Create non-root user and ensure directory ownership
RUN adduser -S appuser -u 1001 && mkdir -p /app/models && chown -R appuser /app

# Copy the deploy folder
COPY --chown=appuser --from=builder /deploy ./

# Explicitly copy Prisma schema and engines just in case
COPY --chown=appuser --from=builder /app/apps/api/prisma ./prisma

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/src/index.js"]






