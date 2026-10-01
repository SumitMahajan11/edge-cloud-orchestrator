# Stage 1: Build
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app

ENV PNPM_CONFIG_IGNORE_SCRIPTS=true
ENV NEXT_TELEMETRY_DISABLED=1

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

COPY . .

RUN pnpm install --filter=@edgecloud/web... --no-frozen-lockfile --ignore-scripts
RUN pnpm --filter=@edgecloud/api-client build
RUN pnpm --filter=@edgecloud/web build

# Stage 2: Runner
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next ./apps/web/.next
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/package.json ./apps/web/package.json
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules

USER nextjs

EXPOSE 3000

CMD ["node", "apps/web/node_modules/next/dist/bin/next", "start", "apps/web"]
