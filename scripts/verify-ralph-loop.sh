#!/bin/bash
# Ralph Loop Completion Verification Script
# Run this before outputting the completion promise

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

echo "=== Ralph Loop Completion Verification ==="
echo ""

pass_count=0
fail_count=0

check() {
  local name="$1"
  local result="$2"
  local details="$3"

  if [ "$result" = "pass" ]; then
    echo -e "${GREEN}✓${NC} $name ${details:+- $details}"
    ((pass_count++))
  else
    echo -e "${RED}✗${NC} $name ${details:+- $details}"
    ((fail_count++))
  fi
}

# 1. Git status - working tree clean
echo "Checking git status..."
if [ -z "$(git status --porcelain)" ]; then
  check "Git clean" "pass"
else
  check "Git clean" "fail" "uncommitted changes detected"
fi

# 2. On main/master branch
branch=$(git branch --show-current)
if [ "$branch" = "main" ] || [ "$branch" = "master" ]; then
  check "On main branch" "pass" "$branch"
else
  check "On main branch" "fail" "currently on $branch"
fi

# 3. Synced with remote
echo "Checking remote sync..."
git fetch origin --quiet 2>/dev/null || true
local_commit=$(git rev-parse HEAD)
remote_commit=$(git rev-parse origin/$branch 2>/dev/null || echo "unknown")
if [ "$local_commit" = "$remote_commit" ]; then
  check "Synced with remote" "pass"
else
  check "Synced with remote" "fail" "local and remote differ"
fi

# 4. Beads closed (check for this session's beads - original + discovered)
echo "Checking beads..."
open_beads=$(bd list --status=open 2>/dev/null | grep -c "remote-dev" || echo "0")
if [ "$open_beads" -eq 0 ]; then
  check "Beads closed (original + discovered)" "pass" "no open beads"
else
  check "Beads closed (original + discovered)" "fail" "$open_beads open beads"
  echo "  Open beads:"
  bd list --status=open 2>/dev/null | grep "remote-dev" | head -5
fi

# 5. No blocked beads
blocked_beads=$(bd blocked 2>/dev/null | grep -c "remote-dev" || echo "0")
if [ "$blocked_beads" -eq 0 ]; then
  check "No blocked beads" "pass"
else
  check "No blocked beads" "fail" "$blocked_beads blocked beads"
fi

# 6. Beads synced with remote
echo "Checking beads sync..."
sync_status=$(bd sync --status 2>/dev/null || echo "unknown")
if echo "$sync_status" | grep -q "up to date\|no changes\|Sync complete"; then
  check "Beads synced" "pass"
else
  check "Beads synced" "fail" "run 'bd sync' to push changes"
fi

# 7. Tests pass
echo "Running tests..."
if bun test --run 2>/dev/null; then
  check "Tests pass" "pass"
else
  check "Tests pass" "fail" "tests failed or not configured"
fi

# 8. Coverage >= 80%
echo "Checking coverage..."
coverage_output=$(bun test --coverage 2>&1 || echo "")
coverage=$(echo "$coverage_output" | grep -E "All files|Statements" | head -1 | grep -oE '[0-9]+\.[0-9]+' | head -1 || echo "0")
coverage_int=${coverage%.*}
if [ "${coverage_int:-0}" -ge 80 ]; then
  check "Coverage >= 80%" "pass" "${coverage}%"
else
  check "Coverage >= 80%" "fail" "${coverage:-0}% (need 80%)"
fi

# 9. Lint passes
echo "Running linter..."
if bun run lint 2>/dev/null; then
  check "Lint" "pass"
else
  check "Lint" "fail" "lint errors found"
fi

# 10. Type check passes
echo "Running type check..."
if bun run typecheck 2>/dev/null; then
  check "Typecheck" "pass"
else
  check "Typecheck" "fail" "type errors found"
fi

# 11. Build succeeds
echo "Running build..."
if bun run build 2>/dev/null; then
  check "Build" "pass"
else
  check "Build" "fail" "build failed"
fi

# 12. No open PRs for feature branches
echo "Checking PRs..."
open_prs=$(gh pr list --state open --json number 2>/dev/null | jq length || echo "unknown")
if [ "$open_prs" = "0" ]; then
  check "No open PRs" "pass"
elif [ "$open_prs" = "unknown" ]; then
  check "No open PRs" "fail" "could not check (gh not configured)"
else
  check "No open PRs" "fail" "$open_prs open PRs"
fi

# Summary
echo ""
echo "=== SUMMARY ==="
echo -e "Passed: ${GREEN}$pass_count${NC}"
echo -e "Failed: ${RED}$fail_count${NC}"
echo ""

if [ $fail_count -eq 0 ]; then
  echo -e "${GREEN}=== ALL CHECKS PASSED ===${NC}"
  echo ""
  echo "You may now output:"
  echo ""
  echo "  <promise>IAMFINALLYDONE</promise>"
  echo ""
  exit 0
else
  echo -e "${RED}=== VERIFICATION FAILED ===${NC}"
  echo ""
  echo "Please address the failing checks before completing the loop."
  exit 1
fi
