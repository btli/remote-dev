#!/usr/bin/env bash
# Watchdog: checks if dev.bryanli.net is reachable, restarts servers after consecutive failures
#
# Run via launchd every 5 minutes, or manually:
#   bash scripts/watchdog.sh
#
# Environment:
#   RDV_DATA_DIR       Override default data directory (~/.remote-dev)
#   EXTERNAL_URL       Override external URL (default: https://dev.bryanli.net)
#   MAX_FAILURES       Consecutive failures before restart (default: 3)
#   DEPLOY_PROJECT_ROOT  Project directory for rdv restart

set -euo pipefail

DATA_DIR="${RDV_DATA_DIR:-$HOME/.remote-dev}"
EXTERNAL_URL="${EXTERNAL_URL:-https://dev.bryanli.net}"
MAX_FAILURES="${MAX_FAILURES:-3}"
PROJECT_ROOT="${DEPLOY_PROJECT_ROOT:-$HOME/Projects/btli/remote-dev}"

DEPLOY_DIR="$DATA_DIR/deploy"
FAILURE_COUNT_FILE="$DEPLOY_DIR/watchdog-failures"
LOCAL_KEY_FILE="$DATA_DIR/rdv/.local-key"

mkdir -p "$DEPLOY_DIR"

# Read local API key if available
API_KEY=""
if [ -f "$LOCAL_KEY_FILE" ]; then
  API_KEY=$(tr -d '[:space:]' < "$LOCAL_KEY_FILE")
fi

# Build auth header
AUTH_HEADER=""
if [ -n "$API_KEY" ]; then
  AUTH_HEADER="Authorization: Bearer $API_KEY"
fi

# Check external URL
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  --connect-timeout 10 --max-time 15 \
  ${AUTH_HEADER:+-H "$AUTH_HEADER"} \
  "$EXTERNAL_URL/api/sessions" 2>/dev/null || echo "000")

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "401" ] || [ "$HTTP_CODE" = "403" ]; then
  # Server is reachable (401/403 = CF Access blocking, still alive)
  echo "$(date): OK ($HTTP_CODE)"
  echo "0" > "$FAILURE_COUNT_FILE"
  exit 0
fi

# Increment failure count
FAILURES=$(cat "$FAILURE_COUNT_FILE" 2>/dev/null || echo "0")
FAILURES=$((FAILURES + 1))
echo "$FAILURES" > "$FAILURE_COUNT_FILE"
echo "$(date): FAIL ($HTTP_CODE), consecutive failures: $FAILURES"

if [ "$FAILURES" -ge "$MAX_FAILURES" ]; then
  echo "$(date): Triggering restart after $FAILURES consecutive failures"

  # Check if a deploy is in progress
  LOCK_FILE="$DEPLOY_DIR/deploy.lock"
  if [ -f "$LOCK_FILE" ]; then
    LOCK_PID=$(cat "$LOCK_FILE" 2>/dev/null || echo "")
    if [ -n "$LOCK_PID" ] && kill -0 "$LOCK_PID" 2>/dev/null; then
      echo "$(date): Deploy in progress (PID: $LOCK_PID), skipping restart"
      exit 0
    fi
  fi

  # Restart using rdv process manager
  cd "$PROJECT_ROOT" && bun run scripts/rdv.ts restart prod

  echo "0" > "$FAILURE_COUNT_FILE"
  echo "$(date): Restart initiated"
fi
