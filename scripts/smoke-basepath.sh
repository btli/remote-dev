#!/usr/bin/env bash
#
# smoke-basepath.sh — manual / CI acceptance check for AC-2/3/4 from
# docs/plans/multi-instance-basepath.md §1. Packages the curl assertions
# documented in §2 of that spec.
#
# Builds twice and runs under two RDV_BASE_PATH configs:
#   1. unset → `/login` returns 200.
#   2. /alpha → `/alpha/login` returns 200 and `/login` returns 404/308.
#
# NOT part of `bun test` — needs `bun run rdv:prod`, free ports, and two
# full `next build`s (~60s each).
#
# IMPORTANT: `scripts/rdv.ts` hardcodes ports 6001/6002 (see `nextPort` /
# `terminalPort` in that file) — it does NOT respect $PORT/$TERMINAL_PORT
# env vars. So this script must be run with NO existing rdv server on
# 6001/6002. If you have one running for your normal dev work, stop it
# first (`bun run rdv:stop`) and restart it after this script finishes.
#
# Worktree caveat: the standalone build resolves to native modules under
# `.next/standalone/node_modules`, which can mismatch the worktree's
# warmed `node_modules` if Node versions differ between the main checkout
# and the worktree. If you see `NODE_MODULE_VERSION` errors, run
# `bun install --force` (or `rm -rf node_modules .next && bun install`)
# in the worktree before invoking this script.
#
# Usage:
#   bash scripts/smoke-basepath.sh
#
# Env knobs:
#   SMOKE_TIMEOUT — seconds to wait for the server to boot (default 90)

set -euo pipefail

PORT=6001
TIMEOUT="${SMOKE_TIMEOUT:-90}"

cleanup() { bun run rdv:stop >/dev/null 2>&1 || true; }
trap cleanup EXIT

if lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[smoke] ABORT: port ${PORT} already in use; stop your existing rdv first." >&2
  exit 1
fi

wait_for() {
  local url="$1" end=$(( $(date +%s) + TIMEOUT ))
  while [ "$(date +%s)" -lt "$end" ]; do
    if curl -fsS -o /dev/null -w '%{http_code}' "$url" 2>/dev/null | grep -qE '^(200|3..)$'; then
      return 0
    fi
    sleep 1
  done
  echo "[smoke] FAIL: $url never came up within ${TIMEOUT}s" >&2; return 1
}

start_run() {
  local label="$1" base_path="$2" auth_suffix="$3"
  echo "[smoke] === ${label} (RDV_BASE_PATH='${base_path}') ==="
  RDV_BASE_PATH="$base_path" bun run build >/dev/null
  RDV_BASE_PATH="$base_path" \
    AUTH_SECRET="$(openssl rand -base64 32)" \
    AUTH_URL="http://localhost:${PORT}${auth_suffix}" \
    bun run rdv:prod >/dev/null
  wait_for "http://localhost:${PORT}${auth_suffix:-/}login"
}

assert_code() {
  local url="$1" want="$2"
  local got
  got="$(curl -s -o /dev/null -w '%{http_code}' "$url")"
  if ! echo "$got" | grep -qE "^${want}$"; then
    echo "[smoke] FAIL: ${url} expected ${want}, got ${got}" >&2; exit 1
  fi
  echo "[smoke] PASS: ${url} → ${got}"
}

# Run 1 — unset basePath: /login must be 200 (AC-1 baseline)
start_run "baseline" "" ""
assert_code "http://localhost:${PORT}/login" "200"
bun run rdv:stop >/dev/null

# Run 2 — /alpha basePath: /alpha/login = 200 (AC-2), /login = 404|308 (AC-3)
start_run "prefixed" "/alpha" "/alpha"
assert_code "http://localhost:${PORT}/alpha/login" "200"
assert_code "http://localhost:${PORT}/login" "(404|308)"

echo "[smoke] All checks passed."
