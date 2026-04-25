#!/bin/bash
# Test script to verify API Gateway hardening
# Tests: request validation, rate limiting, and 429 responses

GATEWAY_URL="${GATEWAY_URL:-http://localhost:80}"
PASS=0
FAIL=0

echo "=========================================="
echo "API Gateway Hardening Verification"
echo "=========================================="
echo ""

# Helper function
test_result() {
  local test_name="$1"
  local expected="$2"
  local actual="$3"
  
  if [ "$expected" = "$actual" ]; then
    echo "✓ PASS: $test_name (expected: $expected, got: $actual)"
    PASS=$((PASS + 1))
  else
    echo "✗ FAIL: $test_name (expected: $expected, got: $actual)"
    FAIL=$((FAIL + 1))
  fi
}

# Test 1: Request Validation - Missing body
echo "--- Test 1: Request Validation (Missing Body) ---"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$GATEWAY_URL/tasks" \
  -H "Content-Type: application/json")
test_result "POST /tasks without body returns 400" "400" "$STATUS"

# Test 2: Request Validation - Invalid JSON
echo ""
echo "--- Test 2: Request Validation (Invalid JSON) ---"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$GATEWAY_URL/tasks" \
  -H "Content-Type: application/json" \
  -d "not valid json")
test_result "POST /tasks with invalid JSON returns 400" "400" "$STATUS"

# Test 3: Request Validation - Missing required fields
echo ""
echo "--- Test 3: Request Validation (Missing Fields) ---"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$GATEWAY_URL/tasks" \
  -H "Content-Type: application/json" \
  -d '{"image":"nginx"}')
test_result "POST /tasks missing 'command' returns 400" "400" "$STATUS"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$GATEWAY_URL/tasks" \
  -H "Content-Type: application/json" \
  -d '{"command":"ls"}')
test_result "POST /tasks missing 'image' returns 400" "400" "$STATUS"

# Test 4: Request Validation - Empty command
echo ""
echo "--- Test 4: Request Validation (Empty Command) ---"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$GATEWAY_URL/tasks" \
  -H "Content-Type: application/json" \
  -d '{"image":"nginx","command":""}')
test_result "POST /tasks with empty command returns 400" "400" "$STATUS"

# Test 5: Request Validation - Valid request (should pass validation, may fail on backend)
echo ""
echo "--- Test 5: Request Validation (Valid Request) ---"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$GATEWAY_URL/tasks" \
  -H "Content-Type: application/json" \
  -d '{"image":"nginx","command":"ls -la"}')
test_result "POST /tasks with valid body passes validation (200 or 502)" "200" "$STATUS"
# Note: 502 is acceptable if backend is down, validation passed at gateway

# Test 6: Rate Limiting - Verify 429 response
echo ""
echo "--- Test 6: Rate Limiting (429 Response) ---"
echo "Sending 120 rapid requests to test rate limiting..."
RATE_LIMITED=0
for i in $(seq 1 120); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$GATEWAY_URL/tasks" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer test-token-123" \
    -d '{"image":"nginx","command":"ls"}' 2>/dev/null)
  if [ "$STATUS" = "429" ]; then
    RATE_LIMITED=$((RATE_LIMITED + 1))
  fi
done

if [ $RATE_LIMITED -gt 0 ]; then
  echo "✓ PASS: Rate limiting triggered ($RATE_LIMITED requests received 429)"
  PASS=$((PASS + 1))
else
  echo "✗ FAIL: No rate limiting detected (expected some 429 responses)"
  FAIL=$((FAIL + 1))
fi

# Test 7: Verify 429 Response Headers
echo ""
echo "--- Test 7: Rate Limit Response Headers ---"
HEADERS=$(curl -s -I -X POST "$GATEWAY_URL/tasks" \
  -H "Content-Type: application/json" \
  -d '{"image":"nginx","command":"ls"}' 2>/dev/null)

if echo "$HEADERS" | grep -q "429"; then
  echo "✓ PASS: 429 status code present"
  PASS=$((PASS + 1))
  
  if echo "$HEADERS" | grep -qi "Retry-After"; then
    echo "✓ PASS: Retry-After header present"
    PASS=$((PASS + 1))
  else
    echo "⚠ WARN: Retry-After header missing (optional)"
  fi
else
  echo "✗ FAIL: 429 status not detected in headers"
  FAIL=$((FAIL + 1))
fi

# Test 8: Health endpoint excluded from rate limiting
echo ""
echo "--- Test 8: Health Endpoint (No Rate Limit) ---"
HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$GATEWAY_URL/health")
test_result "GET /health returns 200" "200" "$HEALTH_STATUS"

# Summary
echo ""
echo "=========================================="
echo "Test Summary"
echo "=========================================="
echo "Passed: $PASS"
echo "Failed: $FAIL"
echo "Total:  $((PASS + FAIL))"
echo ""

if [ $FAIL -eq 0 ]; then
  echo "✓ All tests passed!"
  exit 0
else
  echo "✗ Some tests failed"
  exit 1
fi
