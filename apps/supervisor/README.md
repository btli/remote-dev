# @remote-dev/supervisor

The **k3s Supervisor** — a standalone control-plane service that provisions and
lifecycle-manages Remote Dev **instances** on a Kubernetes (k3s) cluster.

Each instance is an independent, single-tenant `remote-dev` deployment living in
its own namespace (`rdv-<slug>`) behind a supervisor-owned router. The Supervisor
offers an operator dashboard to spin up instances, choose where their persistent
data lives (storage targets), and manage their lifecycle. It talks to the
Kubernetes API directly via `@kubernetes/client-node`.

> **Status: Phase 1 in progress.** Provisioning has landed (remote-dev-jvcx.4):
> `POST`/`DELETE /api/instances` now create/terminate real instances via the
> reconciler. Still pending: storage discovery + dropdown (jvcx.5), the router
> (jvcx.6), and RBAC/Deployments (jvcx.7). Suspend/resume
> (`POST /api/instances/:id/{suspend,resume}`) are defined in the state machine
> but return `501 { code: "PHASE1_PENDING" }` until Phase 2 (jvcx.8).

## Architecture

Mirrors the main app's two-process model:

1. **Next.js** (`PORT`, default **6003**) — operator UI + REST API.
2. **Controller** (`dev:controller`) — a long-running reconciler/capacity loop
   that drives instances toward their desired state from live cluster state.

The Supervisor runs on its **own hostname** (e.g. `sup.example.com`) with its own
Cloudflare Access application — it is not slug-pathed (`basePath` is always `""`).

## Roles & ownership

Three roles gate the API (`src/lib/roles.ts`):

| Role | Capabilities |
|------|--------------|
| `viewer` | read instances / nodes / storage |
| `operator` | create, suspend, resume instances |
| `admin` | delete instances, register storage targets, manage users |

**Instances are owner-scoped:** operators see and manage only the instances they
created; admins see all.

## Provisioning

Each instance is one Kubernetes **namespace** (`rdv-<slug>`, §15 B2) containing a
Secret `rdv-shared` (Cloudflare Access tags), a Secret `rdv-<slug>` (the
instance's **unique `AUTH_SECRET`** + optional GitHub OAuth creds), a headless
Service `rdv` (ports `http`=6001, `ws`=6002), and a single-replica StatefulSet
running the slug-aware instance image under `RDV_BASE_PATH=/<slug>` with a `data`
PVC mounted at `/var/lib/rdv`. An optional first-boot seed Job authorises the
initial emails.

Lifecycle is driven by the **controller** (not the API): the API only writes DB
rows + audit entries. The reconciler (30s poll) advances each instance through
`requested → provisioning → ready` (and `terminating → deleted`) off live
cluster state:

- `POST /api/instances` (operator) inserts a `requested` row and returns `202`.
  The reconciler then **generates the `AUTH_SECRET`**, creates the k8s objects in
  order (namespace → secrets → service → statefulset → optional seed Job), and on
  the first error **rolls back by deleting the namespace** (atomic cascade).
  `AUTH_SECRET` is generated in the controller process so it never reaches the
  API response, the API process, or the database.
- Readiness is gated on the StatefulSet's `readyReplicas ≥ 1` (which itself
  requires the pod's `/<slug>/api/readyz` readiness probe to pass); not-ready past
  a 120s budget → `error`.
- `DELETE /api/instances/:id` (operator; admin **or** owner) marks the row
  `terminating` and returns `202`; the reconciler deletes the namespace and
  confirms it's gone before marking `deleted`.

If no cluster is reachable (local dev without `KUBECONFIG`), the reconcile tick
logs a warning and returns without erroring any instance.

> Storage targets are the cluster **default** for now
> (`SUPERVISOR_DEFAULT_STORAGE_CLASS`/`_SIZE`); live discovery + the per-instance
> dropdown (4 backends) land in jvcx.5.

## Development

From the **repo root**:

```bash
bun install            # resolves this workspace
bun run dev:supervisor # next dev on :6003 (this package's `dev` script)
```

Or from `apps/supervisor`:

```bash
bun run dev            # Next.js UI + API (:6003)
bun run dev:controller # reconciler loop (separate process)
bun run typecheck
bun run lint
bun run test
bun run build
bun run db:push        # push the Drizzle schema to the Supervisor SQLite db
```

## Environment

See [`.env.example`](./.env.example). Key variables:

- `PORT` — UI/API port (default 6003)
- `SUPERVISOR_DATA_DIR` — SQLite location (default `~/.remote-dev-supervisor`)
- `SUPERVISOR_ADMIN_EMAIL` — seeded first admin; local-dev identity when no CF Access
- `SUPERVISOR_CF_ACCESS_TEAM` / `SUPERVISOR_CF_ACCESS_AUD` — the Supervisor's own CF Access app
- `KUBECONFIG` — optional, for local dev against k3d/kind (the client uses `loadFromDefault()`)
- `LOG_LEVEL` — `error|warn|info|debug|trace`

Provisioning (read by the **controller** process):

- `SUPERVISOR_INSTANCE_HOST` — external host instances are served under (used for
  each instance's `AUTH_URL` / `baseUrl`, e.g. `dev.example.com`)
- `SUPERVISOR_INSTANCE_IMAGE` — the slug-aware GHCR `image:sha` the StatefulSet runs
- `SUPERVISOR_DEFAULT_STORAGE_CLASS` — default PVC StorageClass (empty → cluster default)
- `SUPERVISOR_DEFAULT_STORAGE_SIZE` — default PVC size (default `10Gi`)
- `CF_ACCESS_TEAM` / `CF_ACCESS_AUD` — injected into each instance's `rdv-shared` Secret
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` — optional, injected into `rdv-<slug>` Secret
