#!/usr/bin/env bash
# Watchdog: checks the LOCAL origin's liveness, restarts servers after consecutive failures
#
# Probes the Next.js app directly over its unix socket (prod) or TCP port (dev)
# via GET /api/healthz. This intentionally bypasses Cloudflare Access: a probe of
# the public URL returns 302/401/403 from CF's edge whenever the request lacks a
# CF Access service token, which proves only that CF is up — NOT that the origin
# app is alive. Hitting the local origin is the correct liveness signal.
#
# Run via launchd every 5 minutes, or manually:
#   bash scripts/watchdog.sh
#
# Environment:
#   RDV_DATA_DIR       Override default data directory (~/.remote-dev)
#   PORT               TCP port for the dev fallback probe (default: 6001)
#   MAX_FAILURES       Consecutive failures before restart (default: 3)
#   DEPLOY_PROJECT_ROOT  Project directory for rdv restart

set -euo pipefail

DATA_DIR="${RDV_DATA_DIR:-$HOME/.remote-dev}"
MAX_FAILURES="${MAX_FAILURES:-3}"
PROJECT_ROOT="${DEPLOY_PROJECT_ROOT:-$HOME/Projects/btli/remote-dev}"

DEPLOY_DIR="$DATA_DIR/deploy"
FAILURE_COUNT_FILE="$DEPLOY_DIR/watchdog-failures"
NEXTJS_SOCKET="$DATA_DIR/run/nextjs.sock"

mkdir -p "$DEPLOY_DIR"

# Probe the local origin's liveness endpoint. Prefer the unix socket (prod);
# fall back to TCP for dev. The `$(...) || HTTP_CODE="000"` form keeps `set -e`
# from aborting when curl exits non-zero (connection refused, timeout) and
# overwrites (rather than appends) the value, so a failure yields a clean "000".
# HTTP error codes themselves still come through because of `-s -o /dev/null -w`.
if [ -S "$NEXTJS_SOCKET" ]; then
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    --max-time 10 \
    --unix-socket "$NEXTJS_SOCKET" \
    "http://localhost/api/healthz" 2>/dev/null) || HTTP_CODE="000"
else
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    --connect-timeout 10 --max-time 15 \
    "http://127.0.0.1:${PORT:-6001}/api/healthz" 2>/dev/null) || HTTP_CODE="000"
fi

if [ "$HTTP_CODE" = "200" ]; then
  # Local origin is alive and responsive.
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
