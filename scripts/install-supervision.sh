#!/usr/bin/env bash
# Shim for the canonical supervision installer (remote-dev-7fsq §3.8).
# All logic lives in install-supervision.ts — bash cannot hold the control
# flock across the transaction, so this only locates bun and delegates.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v bun &>/dev/null; then
  echo "[install-supervision] bun is required (https://bun.sh) but was not found on PATH" >&2
  exit 1
fi

exec bun "$SCRIPT_DIR/install-supervision.ts" "$@"
