#!/usr/bin/env bash
# Watchdog: checks the LOCAL origin's liveness, restarts servers after consecutive failures
#
# Probes the Next.js app directly over its unix socket (prod) or TCP port (dev).
# This intentionally bypasses Cloudflare Access: a probe of the public URL returns
# 302/401/403 from CF's edge whenever the request lacks a CF Access service token,
# which proves only that CF is up — NOT that the origin app is alive. Hitting the
# local origin is the correct liveness signal.
#
# TWO probes must BOTH pass for the origin to count as healthy:
#   1. GET /api/healthz   → proves the Node process is up (must be 200).
#   2. GET /login (SSR)   → proves the BUILD actually serves pages (must be 200).
# The healthz-only check used to pass during the 2026-06-03 incident, where every
# SSR page 500'd while /api/healthz still returned 200 — so the watchdog never
# restarted the broken build. The /login==200 rule mirrors the deploy/rollback
# health gate's `isAcceptableSsrStatus("/login", …)` in scripts/deploy-lib.ts
# (which also requires exactly 200), keeping the two gates in parity. A failed or
# non-200 SSR probe feeds the SAME consecutive-failure → MAX_FAILURES → restart
# path as a dead process, so a broken build auto-recovers after MAX_FAILURES ticks.
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

# Probe a single path on the local origin and echo the HTTP status code. Prefers
# the unix socket (prod); falls back to TCP for dev. The `$(...) || HTTP_CODE="000"`
# form keeps `set -e` from aborting when curl exits non-zero (connection refused,
# timeout) and overwrites (rather than appends) the value, so a failure yields a
# clean "000". HTTP error codes themselves still come through because of
# `-s -o /dev/null -w`.
probe() {
  local path="$1"
  local code
  if [ -S "$NEXTJS_SOCKET" ]; then
    code=$(curl -s -o /dev/null -w "%{http_code}" \
      --max-time 10 \
      --unix-socket "$NEXTJS_SOCKET" \
      "http://localhost${path}" 2>/dev/null) || code="000"
  else
    code=$(curl -s -o /dev/null -w "%{http_code}" \
      --connect-timeout 10 --max-time 15 \
      "http://127.0.0.1:${PORT:-6001}${path}" 2>/dev/null) || code="000"
  fi
  echo "$code"
}

# Probe 1: process liveness.
HEALTHZ_CODE=$(probe "/api/healthz")
# Probe 2: SSR page serving. Only meaningful once the process is up, but we always
# run it so the log shows both signals on every tick.
SSR_CODE=$(probe "/login")

# Healthy ONLY when the process is up (healthz==200) AND the build serves pages
# (SSR /login==200, mirroring isAcceptableSsrStatus in scripts/deploy-lib.ts).
if [ "$HEALTHZ_CODE" = "200" ] && [ "$SSR_CODE" = "200" ]; then
  echo "$(date): OK healthz=$HEALTHZ_CODE ssr(/login)=$SSR_CODE"
  echo "0" > "$FAILURE_COUNT_FILE"
  exit 0
fi

# Increment failure count
FAILURES=$(cat "$FAILURE_COUNT_FILE" 2>/dev/null || echo "0")
FAILURES=$((FAILURES + 1))
echo "$FAILURES" > "$FAILURE_COUNT_FILE"
echo "$(date): FAIL healthz=$HEALTHZ_CODE ssr(/login)=$SSR_CODE, consecutive failures: $FAILURES"

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

  # Restart using rdv process manager. This is the ONE place we deliberately
  # tolerate a non-zero exit: under `set -e`, a failed restart would abort the
  # script BEFORE the counter reset below, leaving FAILURES >= MAX_FAILURES so
  # every subsequent tick restarts again → a restart storm. The `if ! ( … )`
  # guard absorbs the failure (subshell so a failed `cd` can't strand us in
  # PROJECT_ROOT either), and the counter is reset REGARDLESS so retries are
  # throttled to once per MAX_FAILURES ticks.
  if ! ( cd "$PROJECT_ROOT" && bun run scripts/rdv.ts restart prod ); then
    echo "$(date): WARN restart command exited non-zero"
  fi

  echo "0" > "$FAILURE_COUNT_FILE"
  echo "$(date): Restart initiated"
fi
