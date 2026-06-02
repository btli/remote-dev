#!/usr/bin/env bash
# remote-dev container entrypoint
#
# Starts the Next.js server and the terminal WebSocket server side by side.
# When either exits, propagate the exit so the container restarts.

set -euo pipefail

: "${RDV_DATA_DIR:=/var/lib/rdv}"
: "${PORT:=6001}"
: "${TERMINAL_PORT:=6002}"

# PVC writability checks. Without these, a wrong `fsGroup` or read-only
# mount surfaces as a cryptic `set -e` exit later when the app first tries
# to write — a clear pre-flight error here gives operators an obvious
# pointer to securityContext.fsGroup.
if ! mkdir -p "$RDV_DATA_DIR" 2>/dev/null; then
    echo "[entrypoint] FATAL: cannot create $RDV_DATA_DIR — pod needs securityContext.fsGroup: 10001" >&2
    exit 1
fi
# Check both write (-w) AND execute (-x). On POSIX, the execute bit on a
# directory is required to traverse it (open files inside, create subdirs).
# A PVC mounted with mode 0666 (writable but not searchable) would pass a
# `-w` check, then fail later on `tmux start` with cryptic "permission
# denied" errors. Fail loudly here instead.
if ! [ -w "$RDV_DATA_DIR" ] || ! [ -x "$RDV_DATA_DIR" ]; then
    echo "[entrypoint] FATAL: $RDV_DATA_DIR is not writable+executable by uid $(id -u) — check securityContext.fsGroup (need 10001) and PVC mount mode" >&2
    exit 1
fi

# Pin tmux sockets to the PVC. Default tmux socket dir is /tmp which is
# ephemeral inside a container: on pod restart, every "running" session in
# SQLite would become an orphan because its tmux socket is gone. Putting
# the socket dir under RDV_DATA_DIR (a PVC in production) keeps sockets
# alive across container restarts within the same pod.
export TMUX_TMPDIR="${RDV_DATA_DIR}/tmux"
mkdir -p "$TMUX_TMPDIR"

# ──────────────────────────────────────────────────────────────────────────
# basePath materialization (slug-aware single image)
#
# Next.js bakes `basePath`/`assetPrefix` at BUILD time, so the image was built
# once with the `/rdvslug` sentinel (Dockerfile build stage). Here we rewrite
# that sentinel to this instance's real slug across the ENTIRE runtime tree so
# the static build output matches the runtime RDV_BASE_PATH that the node
# processes read via src/lib/base-path.ts.
#
# Scope (Codex B1): rewrite /app/server.js AND /app/.next AND /app/public.
# `Dockerfile` copies `.next/standalone` -> `/app`, so the standalone entry
# `/app/server.js` (and its server chunks) also embed the baked basePath; a
# naive `.next`-only rewrite would leave server.js pointing at /rdvslug.
# /app/public is scanned too as a defensive safety net: it currently carries
# NO sentinel (the service worker moved to the runtime-templated route
# src/app/sw.js/route.ts, and manifest.json uses manifest-relative paths), but
# scanning it costs nothing and guards against any future sentinel-bearing
# static asset landing in public/.
#
# Slug semantics (Codex M1): under the supervisor, instances are ALWAYS slugged
# (they live at /<slug>); root (empty SLUG_PREFIX) is the non-k8s build path
# (local dev / Electron / single-host prod) which builds normally with basePath
# omitted and does NOT use this image. Materialize-to-empty is supported here
# (sentinel -> "") for completeness, but the canonical k8s use is a real slug.
#
# This pass REWRITES FILES IN /app (the build output), so the image requires a
# writable root filesystem: `securityContext.readOnlyRootFilesystem: true` is
# INCOMPATIBLE with this image and would crash the boot. (No manifest in-repo;
# noted here so a later hardening pass doesn't silently break startup.)
#
# No idempotency marker: in standard k8s the image layer is ephemeral per
# container start, so every fresh boot sees the pristine `/rdvslug` artifact and
# a marker would never save work; on a hypothetically persisted layer with a
# changed slug, a marker would cause a silent stale-slug skip. We always run the
# (no-match-tolerant) pass, then the hard gate — simpler and always correct.
SLUG_PREFIX="${RDV_BASE_PATH:-}"
MATERIALIZE_TARGETS=(/app/server.js /app/.next /app/public)

echo "[entrypoint] materializing basePath: /rdvslug -> '${SLUG_PREFIX:-<root>}'"
# Escape any '#' in the slug so it can't break the sed s### delimiter (slugs are
# validated to /[a-z0-9-]/ upstream, but be defensive).
SED_REPL="${SLUG_PREFIX//#/\\#}"
# Stream NUL-delimited matches straight into `xargs -0 sed` (NUL-safe for any
# filename — do NOT capture into a shell var, which strips NUL bytes and would
# glue every path into one bogus argument). `xargs -r` no-ops on zero matches.
#
# Under `set -euo pipefail` a no-match grep exits 1 and pipefail would propagate
# it, aborting the boot before the servers start — and that fires on any
# sentinel-free tree (root build, or a re-run). So we disable errexit/pipefail
# for just this pipeline (same `set +e`/`set -e` pattern used around `wait -n`
# below), then check ONLY sed's exit status: no-match (grep=1, sed not run, or
# sed=0) is benign; a real sed failure (rc>1 region) still aborts via the gate
# below and an explicit re-raise here.
set +e
set +o pipefail
grep -rlZ '/rdvslug' "${MATERIALIZE_TARGETS[@]}" 2>/dev/null \
    | xargs -0 -r sed -i "s#/rdvslug#${SED_REPL}#g"
SED_RC="${PIPESTATUS[1]}"   # status of `xargs/sed`, independent of grep no-match
set -o pipefail
set -e
if [ "${SED_RC:-0}" -ne 0 ]; then
    echo "[entrypoint] FATAL: sed failed during basePath materialization (rc=${SED_RC})" >&2
    exit 1
fi

# Hard gate (Codex B1): no sentinel may survive ANYWHERE in the runtime tree.
# A surviving /rdvslug means a broken instance (assets 404, auth loops), so fail
# loudly at boot instead of serving a half-rewritten app.
if grep -rq '/rdvslug' "${MATERIALIZE_TARGETS[@]}" 2>/dev/null; then
    echo "[entrypoint] FATAL: basePath materialization incomplete — '/rdvslug' still present in:" >&2
    grep -rl '/rdvslug' "${MATERIALIZE_TARGETS[@]}" 2>/dev/null | sed 's/^/[entrypoint]   /' >&2
    exit 1
fi
echo "[entrypoint] basePath materialization complete"

# Seed the authorized_users table by running `bun run db:seed` against this
# container after first boot:
#   kubectl -n rdv exec deploy/rdv -- env AUTHORIZED_USERS=... bun run db:seed
# We deliberately do not run it from the entrypoint because the seed script
# lives at src/db/seed.ts and is not shipped in the standalone runtime image.

# Bootstrap the instance DB schema (remote-dev-fmcq) on a fresh per-instance PVC.
# Idempotent (CREATE ... IF NOT EXISTS) so it is a no-op on an existing DB. MUST
# use node, not bun (bun crashes loading the @libsql native binding). Fail the
# boot loudly on error rather than serving a schemaless instance that never
# reaches readyz.
echo "[entrypoint] bootstrapping instance DB schema"
if ! node /app/scripts/instance-bootstrap-db.mjs; then
  echo "[entrypoint] FATAL: instance DB schema bootstrap failed" >&2
  exit 1
fi

# Start the terminal server in the background.
echo "[entrypoint] starting terminal server on port ${TERMINAL_PORT}"
node ./dist-terminal/index.js &
TERMINAL_PID=$!

# Start Next.js in the background (standalone server.js comes from `next build`).
echo "[entrypoint] starting next.js on port ${PORT}"
node ./server.js &
NEXT_PID=$!

# Best-effort, NON-BLOCKING agent-CLI auto-update. The user wants provisioned
# instances to keep their agents current; the CLIs are baked at build time, but
# a long-lived instance should pick up new releases. We do this AFTER the servers
# are up so it never delays readiness, fully backgrounded, with every error
# swallowed — a registry hiccup or offline box must NEVER fail or stall the boot.
# Output goes to /tmp/agent-update.log for debugging. Runs in a backgrounded,
# `set +e` subshell so nothing inside it can trip the script's `set -euo
# pipefail` or affect the foreground boot path.
echo "[entrypoint] kicking off background agent-CLI auto-update (non-blocking)"
(
    set +e
    {
        sudo npm update -g \
            @anthropic-ai/claude-code \
            @openai/codex \
            @google/gemini-cli \
            opencode-ai
        # Antigravity: best-effort. Use its own updater if present, else try the
        # installer (whose URL is currently 404 — this will simply no-op until it
        # is restored). All errors are swallowed by the enclosing `set +e`.
        if command -v agy >/dev/null 2>&1 && agy update --help >/dev/null 2>&1; then
            agy update
        else
            curl -fsSL https://google.dev/antigravity/install | sh
        fi
    } >/tmp/agent-update.log 2>&1
) &
disown 2>/dev/null || true

# Propagate signals to both children with a hard timeout. K8s default
# terminationGracePeriodSeconds=30 sends SIGTERM, waits, then SIGKILLs at
# t=30s. We force-kill at t=25s so we exit cleanly under our own control
# rather than getting K9'd mid-flush.
term() {
    echo "[entrypoint] received termination signal, stopping children"
    kill -TERM "$TERMINAL_PID" "$NEXT_PID" 2>/dev/null || true
    # Background killer: if children haven't exited in 25s, SIGKILL them
    # so the foreground `wait` returns before K8s' SIGKILL hits us.
    ( sleep 25 && kill -KILL "$TERMINAL_PID" "$NEXT_PID" 2>/dev/null || true ) &
    KILLER=$!
    wait "$TERMINAL_PID" "$NEXT_PID" 2>/dev/null || true
    kill "$KILLER" 2>/dev/null || true
    exit 0
}
trap term TERM INT

# Wait on either child; whichever exits first wins.
#
# `wait -n` under `set -e` is a footgun: if the first child exits non-zero,
# `wait -n` returns that code and `set -e` would kill the entrypoint before
# `RC=$?` runs, masking the actual exit code. Disable `set -e` around the
# wait so we can capture the code reliably, then re-enable.
set +e
wait -n
RC=$?
set -e

echo "[entrypoint] a child exited (rc=$RC); shutting down siblings"
kill -TERM "$TERMINAL_PID" "$NEXT_PID" 2>/dev/null || true
wait || true
exit "$RC"
