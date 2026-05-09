# Stage 1: Builder
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app
RUN corepack enable pnpm

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/ ./packages/
COPY apps/task-service/package.json ./apps/task-service/

RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter "@edgecloud/task-service" build
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

# Stage 2: Runner
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3003

RUN adduser -S appuser -u 1001

COPY --from=builder /app/apps/task-service/dist ./apps/task-service/dist
COPY --from=builder /app/apps/task-service/package.json ./apps/task-service/
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages

RUN chown -R appuser /app
USER appuser

EXPOSE 3003

HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3003/health || exit 1

CMD ["node", "apps/task-service/dist/index.js"]
