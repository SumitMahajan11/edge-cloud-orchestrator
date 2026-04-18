FROM node:18-alpine AS builder

WORKDIR /app

# Copy root configurations
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./

# Copy packages if needed (none for this simple service yet)
# COPY packages ./packages

# Copy metrics-service
COPY apps/metrics-service ./apps/metrics-service

# Install dependencies (only what's needed for metrics-service)
RUN npm install -g pnpm && \
    pnpm install --filter @edgecloud/metrics-service...

# Build the service
RUN pnpm --filter @edgecloud/metrics-service build

FROM node:18-alpine

WORKDIR /app

COPY --from=builder /app/apps/metrics-service/package.json ./
COPY --from=builder /app/apps/metrics-service/dist ./dist
COPY --from=builder /app/apps/metrics-service/node_modules ./node_modules

EXPOSE 3005

CMD ["node", "dist/index.js"]
