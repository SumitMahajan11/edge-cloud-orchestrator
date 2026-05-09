#!/bin/bash
set -e

# Load Test Orchestrator
# This script runs the full suite of load tests and generates a BENCHMARK.md report.

echo "📊 Starting Edge-Cloud Orchestrator Load Test Suite (v4.0.0)"

# Ensure results directory exists
mkdir -p tests/load/results

# 1. Start the API stack in the background
# We use mock mode since Docker is not available in the environment
echo "🚀 Starting API Server in MOCK mode (Interval: 50ms)..."
export SCHEDULING_INTERVAL=50
export NODE_ENV=development
export FORCE_MOCK_DB=true
export FORCE_MOCK_REDIS=true
export REDIS_URL=""
export JWT_SECRET=load_test_secret_at_least_32_chars_long

# Start API
# Note: Using tsx to run from source for simplicity, or dist if built
npx cross-env LOG_LEVEL=debug FORCE_MOCK_DB=true FORCE_MOCK_REDIS=true SCHEDULING_INTERVAL=50 JWT_SECRET=load_test_secret_at_least_32_chars_long npx tsx apps/api/src/index.ts > tests/load/results/api.log 2>&1 &
API_PID=$!

# Wait for API to be ready
echo "⏳ Waiting for API readiness (health check)..."
MAX_RETRIES=60
RETRY_COUNT=0
until curl -s http://127.0.0.1:3000/health | grep -q "status" || [ $RETRY_COUNT -eq $MAX_RETRIES ]; do
  sleep 1
  RETRY_COUNT=$((RETRY_COUNT+1))
  if [ $((RETRY_COUNT % 5)) -eq 0 ]; then
    echo "  Still waiting ($RETRY_COUNT/60)..."
  fi
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
  echo "❌ API failed to start in 60s"
  cat tests/load/results/api.log | tail -n 20
  exit 1
fi
echo "✅ API is ready!"

# 2. Run Tests
echo "🧪 Running Latency Test..."
npx tsx tests/load/scheduling-latency.ts

echo "🧪 Running Capacity Test..."
npx tsx tests/load/node-capacity.ts

echo "🧪 Running Throughput Test..."
npx tsx tests/load/throughput.ts

# 3. Cleanup
echo "🛑 Shutting down API..."
kill $API_PID

# 4. Generate BENCHMARK.md
echo "📝 Generating BENCHMARK.md..."
npx tsx tests/load/generate-benchmark-report.ts

echo "✅ All tests completed! Report generated in BENCHMARK.md"
