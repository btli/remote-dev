#!/usr/bin/env bash
# Supervisor-router E2E smoke orchestrator (spec §11 M8 / bd remote-dev-jvcx.11).
#
# Builds the three platform images (or reuses pre-built ones), boots the compose
# stack (Supervisor + router + 2 slug-aware instances), seeds two `ready`
# instance rows, waits for the router to publish them, then runs the smoke
# assertions THROUGH THE ROUTER (deploy/k8s/supervisor/e2e/smoke.ts). Tears the
# stack down on exit and surfaces container logs on failure.
#
# Usage:
#   ./run.sh                 build images + run smoke + teardown
#   ./run.sh --no-build      reuse existing *:e2e images (CI builds them first)
#   ./run.sh --keep          leave the stack up after the smoke (debugging)
#
# Requirements: docker (with compose v2) + bun on PATH. Images build on amd64;
# on Apple Silicon they build under emulation/native arm64 (the router + supervisor
# are arch-neutral; the instance dev-env image builds for the host arch).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${HERE}/docker-compose.yml"
PROJECT="rdv-router-e2e"

DO_BUILD=1
KEEP=0
for arg in "$@"; do
  case "$arg" in
    --no-build) DO_BUILD=0 ;;
    --keep) KEEP=1 ;;
    -h | --help)
      sed -n '2,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "unknown arg: $arg" >&2
      exit 2
      ;;
  esac
done

# Deterministic test-only secrets, shared by compose + the host-run smoke. These
# are NOT real credentials — they only need to agree across the three services.
export E2E_INSTANCE_AUTH_SECRET="${E2E_INSTANCE_AUTH_SECRET:-rdv-e2e-smoke-shared-auth-secret-000000000000}"
export SUPERVISOR_INTERNAL_SECRET="${SUPERVISOR_INTERNAL_SECRET:-rdv-e2e-internal-secret}"
export SUPERVISOR_ADMIN_EMAIL="${SUPERVISOR_ADMIN_EMAIL:-smoke@example.com}"
export E2E_SLUGS="${E2E_SLUGS:-alpha,beta}"
export ROUTER_HOST_PORT="${ROUTER_HOST_PORT:-6004}"

DC=(docker compose -p "$PROJECT" -f "$COMPOSE_FILE")

dump_logs() {
  echo "::group::compose logs (${PROJECT})" || true
  "${DC[@]}" ps || true
  "${DC[@]}" logs --no-color --tail 200 || true
  echo "::endgroup::" || true
}

cleanup() {
  local rc=$?
  if [ "$rc" -ne 0 ]; then
    echo ">> smoke FAILED (rc=$rc) — dumping container logs" >&2
    dump_logs
  fi
  if [ "$KEEP" -eq 1 ]; then
    echo ">> --keep set: leaving the stack up (teardown with: ${DC[*]} down -v)"
  else
    echo ">> tearing down the stack"
    "${DC[@]}" down -v --remove-orphans || true
  fi
  exit "$rc"
}
trap cleanup EXIT

echo ">> E2E smoke: router single-front-door (slugs: ${E2E_SLUGS})"

if [ "$DO_BUILD" -eq 1 ]; then
  echo ">> building images (supervisor, router, instance dev-env)…"
  "${DC[@]}" build
fi

# Bring up the long-lived services and block on their health gates (the router
# itself depends_on supervisor+instances being healthy, so `--wait router` gates
# the whole upstream chain). We deliberately exclude the one-shot `seed` from this
# `--wait` set and run it explicitly below, so its normal exit is never mistaken
# for a failure.
echo ">> starting stack (waiting for health gates)…"
# --wait-timeout gives a slow/cold first boot (image pull + instance materialize +
# DB bootstrap + two Next servers) generous headroom; on native CI this is fast.
"${DC[@]}" up -d --wait --wait-timeout "${E2E_WAIT_TIMEOUT_S:-240}" \
  supervisor instance-alpha instance-beta router

# Run the seed one-shot to completion. `docker compose wait` blocks until the
# container stops and EXITS WITH the container's own exit code (it also prints a
# human-readable line to stdout — we key off the exit status, not the text). The
# explicit `if` keeps `set -e` from aborting on a non-zero seed before we can log.
echo ">> seeding ready instances…"
"${DC[@]}" up -d seed
if "${DC[@]}" wait seed; then
  echo ">> seed OK"
else
  echo ">> seed did not exit 0; logs:" >&2
  "${DC[@]}" logs --no-color seed || true
  exit 1
fi

# Give the router one allowlist poll cycle to pick up the seeded routes (it polls
# every ROUTER_ALLOWLIST_POLL_MS=2000ms in the compose).
echo ">> waiting for the router to publish the seeded routes…"
ROUTER_URL="http://localhost:${ROUTER_HOST_PORT}"
ok=0
for _ in $(seq 1 30); do
  # A ready slug returns the instance login (200) instead of falling through to
  # the Supervisor — that confirms the allowlist is live.
  code="$(curl -s -o /dev/null -w '%{http_code}' "${ROUTER_URL}/$(echo "$E2E_SLUGS" | cut -d, -f1)/api/healthz" || echo 000)"
  if [ "$code" = "200" ]; then
    ok=1
    break
  fi
  sleep 1
done
if [ "$ok" -ne 1 ]; then
  echo ">> router never published the seeded routes (first slug /api/healthz != 200)" >&2
  exit 1
fi
echo ">> routes are live"

# Run the assertions through the router (host-side bun; talks only to the router).
echo ">> running smoke assertions…"
ROUTER_BASE_URL="$ROUTER_URL" \
  E2E_SLUGS="$E2E_SLUGS" \
  E2E_INSTANCE_AUTH_SECRET="$E2E_INSTANCE_AUTH_SECRET" \
  bun "${HERE}/smoke.ts"

echo ">> smoke PASSED"
