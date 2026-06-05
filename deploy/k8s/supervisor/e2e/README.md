# Supervisor-router E2E smoke

A repeatable, **containerized** regression-guard for the single-front-door
**router** (`apps/supervisor-router`) — the Phase-0 acceptance artifact for the
k3s supervisor platform (spec `docs/plans/2026-05-30-k3s-supervisor-platform.md`
§11 + §15 **M5/M8**, bd `remote-dev-jvcx.11`).

It boots the **whole data path** with docker-compose and asserts **end-to-end,
through the router only**:

1. the **Supervisor** login page is reachable at **root** (`/login`) through the
   router (Option C: root → dashboard) and a static asset loads;
2. each **instance** login is reachable at **`/<slug>/login`**, its HTML
   references the **materialized** `/<slug>/_next/...` asset prefix (proving the
   slug-aware basePath rewrite happened in the image), and one of those hashed
   assets loads;
3. a **live WebSocket terminal** connects over **`/<slug>/ws`** through the
   router, creates a tmux-backed PTY, and echoes a sentinel back (bidirectional).

> The live router path is already **proven manually** on the homelab
> (`rdv.joyful.house` routes root → supervisor and `/<slug>/` → instance). This
> harness is the **CI artifact that guards it against regression** — a test, not
> product functionality.

## Topology

```
smoke ──http/ws──▶ router:6004 ──┬─ /            ▶ supervisor:6003  (dashboard)
   (host bun)                    ├─ /alpha/*     ▶ instance-alpha:6001 (+ :6002 ws)
                                 └─ /beta/*      ▶ instance-beta:6001  (+ :6002 ws)
```

The router is the **only** published port; the smoke talks to nothing else.

### How it works without Kubernetes

The router resolves instances by the cluster-DNS **convention**
`rdv.rdv-<slug>.svc.cluster.local` (it reads the slug→namespace map from the
Supervisor's `GET /api/internal/routes` allowlist). The harness reproduces that
with **no k8s**:

- each instance container gets that exact name as a Docker **network alias**, so
  the router's unmodified in-cluster authority resolves here verbatim;
- the **Supervisor** runs with no k8s client call (provisioning never fires —
  `SUPERVISOR_ALLOW_INSECURE_AUTH=1` lets it boot in prod with no CF/OIDC), and
  the **seed** one-shot inserts the two `ready` instance rows the allowlist
  endpoint serves (the `/api/internal/routes` handler reads them straight from
  the Supervisor DB, so the router lights up on its next poll);
- the **WS terminal** auth is an `HMAC(sessionId:userId:timestamp)` over a shared
  test `AUTH_SECRET` (mirrors `src/lib/ws-token.ts`). The terminal server creates
  the tmux session + PTY from a valid token with **no DB session row required**,
  so the smoke needs only the shared secret — not a provisioned project/session.

## Files

| File | Role |
|---|---|
| `docker-compose.yml` | the 4-service stack (+ `seed` one-shot) and its health gates |
| `seed-instances.ts` | bun script run **inside** the supervisor image: inserts 1 owner + N `ready` instance rows into `supervisor.db` |
| `smoke.ts` | bun script (host): the end-to-end assertions through the router |
| `run.sh` | orchestrator: build → up (health-gated) → verify seed → wait for routes → smoke → teardown |

## Run it locally

Requires **docker** (compose v2) + **bun**. Images build on amd64; on Apple
Silicon they build for the host arch.

```bash
# Build the three images, boot the stack, seed, smoke, tear down:
./deploy/k8s/supervisor/e2e/run.sh

# Reuse already-built *:e2e images (CI builds them first):
./deploy/k8s/supervisor/e2e/run.sh --no-build

# Leave the stack up afterwards to poke at it (teardown printed at the end):
./deploy/k8s/supervisor/e2e/run.sh --keep
```

The **instance dev-env image is heavy** (5 agent CLIs, sudo/apt), so the first
build dominates wall time; subsequent runs hit the Docker layer cache.

### Tunables (env)

| Var | Default | Meaning |
|---|---|---|
| `E2E_SLUGS` | `alpha,beta` | instance slugs to provision + assert |
| `ROUTER_HOST_PORT` | `6004` | host port the router publishes on |
| `E2E_INSTANCE_AUTH_SECRET` | deterministic test value | shared instance `AUTH_SECRET` (mints the WS token) |
| `SUPERVISOR_INTERNAL_SECRET` | `rdv-e2e-internal-secret` | router↔supervisor allowlist secret |
| `SUPERVISOR_ADMIN_EMAIL` | `smoke@example.com` | seeded instance owner |
| `NODE_VERSION` | `24-trixie-slim` | instance image Node base (Node 24 + trixie glibc; the bare `24` fails the image's `rdv` glibc gate) |

## CI

`.github/workflows/supervisor-router-e2e.yml` builds the three images on
**Node 24** with scoped GHA layer caches (`--load` into the local daemon, never
pushed), then runs `run.sh --no-build`. It triggers on changes to the router,
supervisor, instance image, or this harness (and on `workflow_dispatch`).

## Scope / non-goals

- This is the **router** regression-guard, not a full k8s integration test. It
  deliberately uses compose (lighter than kind/k3d) and stubs the cluster-DNS
  convention with network aliases; real provisioning, storage targets, and the
  reconciler are covered by `apps/supervisor`'s own unit tests.
- The instance is the **real** slug-aware `dev-env` image (not a mock) so the
  materialization + live WS terminal are asserted against the actual artifact the
  router proxies in production.
