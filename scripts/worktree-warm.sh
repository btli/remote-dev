#!/usr/bin/env bash
#
# worktree-warm.sh — fast node_modules bootstrap for agent worktrees
#
# Problem: `bun run build` (Next.js + Turbopack 16) refuses to follow a
# top-level `node_modules` symlink that points outside the worktree's
# filesystem root, and `bun install` from cold can take 9+ minutes here.
#
# Fix: clone the main checkout's `node_modules/` into the worktree using APFS
# `cp -cR` (clonefile, copy-on-write). Internal symlinks in bun's isolated
# layout are relative — they stay valid inside the clone — so Turbopack is
# happy and the cold-start time drops from minutes to ~30 seconds.
#
# Usage (from inside an agent worktree):
#   ./scripts/worktree-warm.sh           # auto-detects the main checkout
#   ./scripts/worktree-warm.sh /path/to/main/repo
#
# Falls back to `bun install` on non-APFS filesystems.

set -euo pipefail

WORKTREE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$WORKTREE_ROOT"

# 1. Detect the main checkout: prefer the explicit arg, else parse `git worktree list`.
if [[ ${1:-} ]]; then
  MAIN_REPO="$1"
else
  # `git worktree list --porcelain` lists the main checkout first.
  MAIN_REPO="$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
fi

if [[ -z "${MAIN_REPO:-}" || ! -d "$MAIN_REPO" ]]; then
  echo "worktree-warm: could not locate main checkout (got: '${MAIN_REPO:-}')" >&2
  exit 1
fi

if [[ "$MAIN_REPO" == "$WORKTREE_ROOT" ]]; then
  echo "worktree-warm: refusing to clone into the main checkout itself" >&2
  exit 1
fi

if [[ ! -d "$MAIN_REPO/node_modules" ]]; then
  echo "worktree-warm: $MAIN_REPO/node_modules does not exist — run 'bun install' there first" >&2
  exit 1
fi

if [[ -e "$WORKTREE_ROOT/node_modules" || -L "$WORKTREE_ROOT/node_modules" ]]; then
  echo "worktree-warm: ./node_modules already exists; remove it first if you want to re-warm" >&2
  exit 1
fi

# 2. Choose strategy. APFS clonefile (`cp -c`) is essentially free and
# preserves relative symlinks; everything else is the slow fallback.
FS_TYPE="$(df -P "$WORKTREE_ROOT" | awk 'NR==2 {print $1}' | xargs -I{} diskutil info {} 2>/dev/null | awk -F: '/Type \(Bundle\)/{gsub(/ /,"",$2); print $2; exit}')"

echo "worktree-warm: cloning node_modules from $MAIN_REPO"
echo "worktree-warm: filesystem type = ${FS_TYPE:-unknown}"

start_ts=$(date +%s)

if [[ "$FS_TYPE" == "apfs" ]]; then
  # APFS copy-on-write clone. Near-instant for ~1.6G; under a minute even cold.
  cp -cR "$MAIN_REPO/node_modules" "$WORKTREE_ROOT/node_modules"
elif command -v rsync >/dev/null 2>&1; then
  echo "worktree-warm: APFS unavailable, falling back to rsync (slower)"
  rsync -a --links "$MAIN_REPO/node_modules/" "$WORKTREE_ROOT/node_modules/"
else
  echo "worktree-warm: no fast clone path available; falling back to 'bun install'"
  bun install
  exit $?
fi

elapsed=$(( $(date +%s) - start_ts ))
echo "worktree-warm: done in ${elapsed}s"
echo "worktree-warm: you can now run 'bun run build', 'bun run typecheck', etc."
