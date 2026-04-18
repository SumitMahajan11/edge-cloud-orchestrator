# --- Stage 1: Build ---
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files from root for workspace support if needed
# But for a simple standalone Dockerfile in the app dir, we can try this:
COPY package*.json ./
# Install ALL dependencies (including dev for tsc)
RUN npm install

# Copy source
COPY tsconfig.json ./
COPY src ./src

# Build
RUN npm run build

# --- Stage 2: Production ---
FROM node:18-alpine

# Create non-root user
RUN addgroup -g 1001 -S edgecloud && \
    adduser -S edgecloud -u 1001 -G edgecloud

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production

# Copy built assets from builder
COPY --from=builder /app/dist ./dist

# Set ownership
RUN chown -R edgecloud:edgecloud /app

# Switch to non-root user
USER edgecloud

# Expose port
EXPOSE 4001

# Health check (updated for dist path if needed, but health is on app)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 4001) + '/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"

# Start server
CMD ["node", "dist/index.js"]
