#!/usr/bin/env bash
# Watchdog shim (remote-dev-7fsq — Spec v3 §3.6): thin curl-probe layer only.
#
# This script is DELIBERATELY dumb. It probes the local prod origin with curl
# (cheap — no Bun startup on healthy ticks) and, on ANY actionable condition,
# delegates to `bun scripts/rdv-supervision.ts watchdog-act <reason>`, which
# holds the control lock for the entire recovery transaction. ALL actuation
# logic — desired-state gating, deploy-lock suppression, grace counting, the
# flap fast-path, ledgers, escalation, launchctl kickstart — lives in the
# supervision core, NOT here.
#
# PROD-ONLY probes over the unix sockets. A missing nextjs.sock is failure
# evidence in its own right; there is NO dev-TCP fallback (a healthy dev
# server must never mask a dead prod stack [F14]).
#
# THREE probes must ALL pass for the origin to count as healthy:
#   1. GET /api/healthz  (nextjs.sock)   → the Node process is up (200).
#   2. GET /login (SSR)  (nextjs.sock)   → the BUILD actually serves pages
#      (200; mirrors isAcceptableSsrStatus in scripts/deploy-lib.ts).
#   3. GET /health       (terminal.sock) → the terminal server is up and its
#      scheduler is ready (the route returns 503 until ready).
#
# Run via launchd every 60 seconds (dev.remote.watchdog.plist), or manually:
#   bash scripts/watchdog.sh
#
# Environment:
#   RDV_DATA_DIR         Override default data directory (~/.remote-dev)
#   MAX_FAILURES         Consecutive failures before restart (default: 2;
#                        passed through to the supervision core)
#   DEPLOY_PROJECT_ROOT  Project directory containing scripts/rdv-supervision.ts

set -euo pipefail

DATA_DIR="${RDV_DATA_DIR:-$HOME/.remote-dev}"
PROJECT_ROOT="${DEPLOY_PROJECT_ROOT:-$HOME/Projects/btli/remote-dev}"

DEPLOY_DIR="$DATA_DIR/deploy"
# The supervision core's watchdog persistence (failures + gen-keyed flap
# ticks). A healthy tick resets it by REMOVING the file — the one write this
# shim performs — so no Bun process ever starts on the healthy path.
WATCHDOG_STATE_FILE="$DEPLOY_DIR/watchdog-state.json"
CUSTODY_JOURNAL="$DEPLOY_DIR/custody-journal.json"
DESIRED_STATE_FILE="$DATA_DIR/server/desired-state.json"
NEXTJS_SOCKET="$DATA_DIR/run/nextjs.sock"
TERMINAL_SOCKET="$DATA_DIR/run/terminal.sock"

mkdir -p "$DEPLOY_DIR"

# Probe a single path over a unix socket and echo the HTTP status code. A
# missing socket file short-circuits to "000" (missing-socket IS failure
# evidence — no TCP fallback). The `|| code="000"` form keeps `set -e` from
# aborting when curl exits non-zero (connection refused, timeout).
probe() {
  local socket="$1" path="$2" code
  if [ ! -S "$socket" ]; then
    echo "000"
    return
  fi
  code=$(curl -s -o /dev/null -w "%{http_code}" \
    --max-time 10 \
    --unix-socket "$socket" \
    "http://localhost${path}" 2>/dev/null) || code="000"
  echo "$code"
}

HEALTHZ_CODE=$(probe "$NEXTJS_SOCKET" "/api/healthz")
SSR_CODE=$(probe "$NEXTJS_SOCKET" "/login")
TERMINAL_CODE=$(probe "$TERMINAL_SOCKET" "/health")

if [ "$HEALTHZ_CODE" = "200" ] && [ "$SSR_CODE" = "200" ] && [ "$TERMINAL_CODE" = "200" ]; then
  echo "$(date): OK healthz=$HEALTHZ_CODE ssr(/login)=$SSR_CODE terminal(/health)=$TERMINAL_CODE"
  # Healthy tick resets the failure/flap persistence (cheap: no Bun startup).
  rm -f "$WATCHDOG_STATE_FILE"
  # Healthy probes can coexist with ABANDONED deploy custody (a deploy killed
  # AFTER its bootstrap leaves a dead-owner journal and/or desired-state
  # maintenance behind forever). Cheap shell-side detection only — the
  # control-locked supervision core does the real classification.
  if [ -f "$CUSTODY_JOURNAL" ] || grep -q '"maintenance"' "$DESIRED_STATE_FILE" 2>/dev/null; then
    echo "$(date): custody evidence present on a healthy tick — running custody-check"
    if ! ( cd "$PROJECT_ROOT" && bun scripts/rdv-supervision.ts watchdog-act custody-check ); then
      echo "$(date): WARN custody-check exited non-zero"
    fi
  fi
  exit 0
fi

REASON="probe-failed:healthz=${HEALTHZ_CODE},ssr=${SSR_CODE},terminal=${TERMINAL_CODE}"
echo "$(date): FAIL $REASON — delegating to supervision core"

# All actuation goes through the control-locked supervision core. Tolerate a
# non-zero exit (e.g. control-lock contention) so `set -e` can't wedge the
# shim; the core owns its own throttling/ledgering.
if ! ( cd "$PROJECT_ROOT" && bun scripts/rdv-supervision.ts watchdog-act "$REASON" ); then
  echo "$(date): WARN watchdog-act exited non-zero"
fi
