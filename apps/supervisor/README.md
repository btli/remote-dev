# @remote-dev/supervisor

The **k3s Supervisor** — a standalone control-plane service that provisions and
lifecycle-manages Remote Dev **instances** on a Kubernetes (k3s) cluster.

Each instance is an independent, single-tenant `remote-dev` deployment living in
its own namespace (`rdv-<slug>`) behind a supervisor-owned router. The Supervisor
offers an operator dashboard to spin up instances, choose where their persistent
data lives (storage targets), and manage their lifecycle. It talks to the
Kubernetes API directly via `@kubernetes/client-node`.

> **Status: scaffold — Phase 1 in progress (remote-dev-jvcx.3).**
> This workspace currently contains the foundation only: DB schema, role-based
> auth, the k8s client wrapper, slug validation, a dashboard shell, a health
> route, auth-wrapped API route **stubs**, and a controller-process skeleton.
> Provisioning (jvcx.4), storage discovery (jvcx.5), the router (jvcx.6), and
> RBAC/Deployments (jvcx.7) are not implemented yet — those endpoints return
> `501 { code: "PHASE1_PENDING" }`.

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
