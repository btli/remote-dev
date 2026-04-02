#!/bin/bash

###############################################################################
# Feature 018: SMS Phone Number Verification
# E2E Test Runner - Runs all test suites
#
# Tests executed:
# 1. test_phone_verification.js - Happy path
# 2. test_phone_verification_errors.js - Error handling
# 3. test_phone_verification_resend.js - Resend functionality
# 4. test_phone_verification_duplicate.js - Duplicate phone handling
# 5. test_phone_verification_accessibility.js - Accessibility
#
# Usage:
#   ./run_all_phone_verification_tests.sh [provider]
#
# Arguments:
#   provider - SMS provider to test (twilio or plivo, default: twilio)
#
# Environment Variables:
#   TEST_BASE_URL - Base URL (default: http://localhost:3000)
#   TEST_PHONE - Test phone number (default: +12025551234)
#   SMS_PROVIDER - Override provider selection
#   MANUAL_TEST - Set to 'true' for manual code entry
###############################################################################

set -e  # Exit on error

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SMS_PROVIDER="${1:-${SMS_PROVIDER:-twilio}}"
TEST_BASE_URL="${TEST_BASE_URL:-http://localhost:3000}"
SCREENSHOT_DIR="/tmp"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test results tracking
TESTS_PASSED=0
TESTS_FAILED=0
FAILED_TESTS=()

echo "╔════════════════════════════════════════════════════════════════════════╗"
echo "║  Feature 018: SMS Phone Number Verification - E2E Test Suite          ║"
echo "╚════════════════════════════════════════════════════════════════════════╝"
echo ""
echo "📱 SMS Provider: ${SMS_PROVIDER}"
echo "🔗 Base URL: ${TEST_BASE_URL}"
echo "📸 Screenshots: ${SCREENSHOT_DIR}"
echo ""

# Check if dev server is running
echo "🔍 Checking if dev server is running..."
if curl -s "${TEST_BASE_URL}" > /dev/null; then
  echo -e "${GREEN}✅ Dev server is running${NC}\n"
else
  echo -e "${RED}❌ Dev server is not running at ${TEST_BASE_URL}${NC}"
  echo "   Start it with: pnpm --filter=@kaelyn/web dev"
  exit 1
fi

# Function to run a test
run_test() {
  local test_name="$1"
  local test_file="$2"
  local description="$3"

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo -e "${BLUE}Running: ${test_name}${NC}"
  echo "Description: ${description}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  if SMS_PROVIDER="${SMS_PROVIDER}" node "${SCRIPT_DIR}/${test_file}"; then
    echo ""
    echo -e "${GREEN}✅ ${test_name} PASSED${NC}\n"
    ((TESTS_PASSED++))
  else
    echo ""
    echo -e "${RED}❌ ${test_name} FAILED${NC}\n"
    ((TESTS_FAILED++))
    FAILED_TESTS+=("${test_name}")
  fi
}

# Run all tests
echo "🚀 Starting test suite...\n"

run_test \
  "Test 1: Happy Path" \
  "test_phone_verification.js" \
  "Complete verification flow from start to finish"

run_test \
  "Test 2: Error Handling" \
  "test_phone_verification_errors.js" \
  "Invalid phone, incorrect codes, rate limiting"

run_test \
  "Test 3: Resend Functionality" \
  "test_phone_verification_resend.js" \
  "Resend button, cooldown timer, code invalidation"

run_test \
  "Test 4: Duplicate Phone" \
  "test_phone_verification_duplicate.js" \
  "Verified phone detection, incomplete verification replacement"

run_test \
  "Test 5: Accessibility" \
  "test_phone_verification_accessibility.js" \
  "Keyboard navigation, ARIA labels, screen reader support"

# Print summary
echo "╔════════════════════════════════════════════════════════════════════════╗"
echo "║  Test Suite Summary                                                    ║"
echo "╚════════════════════════════════════════════════════════════════════════╝"
echo ""
echo -e "${GREEN}✅ Passed: ${TESTS_PASSED}${NC}"
echo -e "${RED}❌ Failed: ${TESTS_FAILED}${NC}"
echo "📸 Screenshots: ${SCREENSHOT_DIR}"
echo ""

if [ ${TESTS_FAILED} -gt 0 ]; then
  echo -e "${RED}Failed tests:${NC}"
  for test in "${FAILED_TESTS[@]}"; do
    echo "  - ${test}"
  done
  echo ""
  exit 1
else
  echo -e "${GREEN}🎉 All tests passed!${NC}"
  echo ""
  exit 0
fi
