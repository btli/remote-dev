#!/usr/bin/env bash
# remote-dev container entrypoint
#
# Starts the Next.js server and the terminal WebSocket server side by side.
# When either exits, propagate the exit so the container restarts.

set -euo pipefail

: "${RDV_DATA_DIR:=/var/lib/rdv}"
: "${PORT:=6001}"
: "${TERMINAL_PORT:=6002}"

# Only ensure the mount root. The app's ensureDataDirectories() (src/lib/paths.ts)
# creates the rest at startup.
mkdir -p "$RDV_DATA_DIR"

# Seed the authorized_users table by running `bun run db:seed` against this
# container after first boot:
#   kubectl -n rdv exec deploy/rdv -- env AUTHORIZED_USERS=... bun run db:seed
# We deliberately do not run it from the entrypoint because the seed script
# lives at src/db/seed.ts and is not shipped in the standalone runtime image.

# Start the terminal server in the background.
echo "[entrypoint] starting terminal server on port ${TERMINAL_PORT}"
node ./dist-terminal/index.js &
TERMINAL_PID=$!

# Start Next.js in the background (standalone server.js comes from `next build`).
echo "[entrypoint] starting next.js on port ${PORT}"
node ./server.js &
NEXT_PID=$!

# Propagate signals to both children.
term() {
    echo "[entrypoint] received termination signal, stopping children"
    kill -TERM "$TERMINAL_PID" "$NEXT_PID" 2>/dev/null || true
    wait "$TERMINAL_PID" "$NEXT_PID" 2>/dev/null || true
    exit 0
}
trap term TERM INT

# Wait on either child; whichever exits first wins.
# `wait -n` returns the exit status of the first child to exit.
wait -n
RC=$?
echo "[entrypoint] a child exited (rc=$RC); shutting down siblings"
kill -TERM "$TERMINAL_PID" "$NEXT_PID" 2>/dev/null || true
wait || true
exit "$RC"
