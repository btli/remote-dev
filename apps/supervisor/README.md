# @remote-dev/supervisor

The **k3s Supervisor** — a standalone control-plane service that provisions and
lifecycle-manages Remote Dev **instances** on a Kubernetes (k3s) cluster.

Each instance is an independent, single-tenant `remote-dev` deployment living in
its own namespace (`rdv-<slug>`) behind a supervisor-owned router. The Supervisor
offers an operator dashboard to spin up instances, choose where their persistent
data lives (storage targets), and manage their lifecycle. It talks to the
Kubernetes API directly via `@kubernetes/client-node`.

> **Status: Phases 1–2 landed.** Provisioning (remote-dev-jvcx.4),
> storage targets (jvcx.5), the router (jvcx.6), RBAC/Deployments (jvcx.7), and
> lifecycle depth (jvcx.8 — suspend/resume scale 0↔1, image rollout, grow-only
> PVC resize, logs/events) are all in. Newest additions: **permanent delete**
> (purge a `deleted` record, jvcx.14), **Start/Stop** terminology for
> suspend/resume (jvcx.15), and a read-only **storage browser** (jvcx.16) — see
> the sections below.

## Architecture

Mirrors the main app's two-process model:

1. **Next.js** (`PORT`, default **6003**) — operator UI + REST API.
2. **Controller** (`dev:controller`) — a long-running reconciler/capacity loop
   that drives instances toward their desired state from live cluster state.

The Supervisor dashboard is **served through the router at `/`** (the single
front door) on the same host as instances and behind the same Cloudflare Access
app — there is no separate hostname or second CF Access app. Its Service is
internal (ClusterIP), reached only via the router. It is not slug-pathed
(`basePath` is always `""`; the router proxies non-instance traffic to it
unchanged).

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
- `DELETE /api/instances/:id` (admin) marks the row `terminating` and returns
  `202`; the reconciler deletes the namespace and confirms it's gone before
  marking `deleted`.

If no cluster is reachable (local dev without `KUBECONFIG`), the reconcile tick
logs a warning and returns without erroring any instance.

### Start / Stop (suspend / resume)

The dashboard surfaces suspend/resume as **Stop** and **Start** (a terminology
change only — the canonical statuses `ready`/`suspended` and audit actions
`suspend`/`resume` are unchanged; `suspended` simply *displays* as **Stopped**).
`POST /api/instances/:id/suspend` and `…/resume` are the canonical routes;
`…/stop` and `…/start` are exact behavioral **aliases** (same operator role,
owner-scoping, and audit actions). All four record desired state + an audit row
and return `202`; the reconciler scales the StatefulSet `1 → 0` (Stop, PVC
retained) or `0 → 1` (Start) on its next tick.

### Permanent delete (purge)

A soft `DELETE` leaves the row at `deleted` forever (so the slug stays reserved
and the dashboard accumulates tombstones). An admin can **purge** a record with
`DELETE /api/instances/:id?purge=true`: it requires `status === "deleted"` (the
reconciler already confirmed the namespace is gone; otherwise `409
INVALID_STATE`) and **hard-deletes the DB row**, which cascades away its
`instance_audit_log` + `instance_seed` rows and **frees the slug for reuse**.
Because the audit trail is erased by design, the purge writes no audit row (it
would be deleted) — it is logged instead. The detail page's **"Remove
permanently"** button (shown only for a `deleted` instance) does this and
redirects to the dashboard.

### Storage browser (read-only)

Operators (owner-scoped; admins included) can browse an instance's persistent
data volume (PVC `data-rdv-0`) **read-only** and download files from the detail
page's **Storage** section, **even when the instance is Stopped**.

How it works: each listing/download dispatches an **ephemeral, self-deleting
Kubernetes Job** (`rdv-inspect-<id>`) in the instance namespace that mounts the
PVC **read-only** at `/inspect` (both the volumeMount and the PVC source are
`readOnly`) and runs a tiny Node script emitting one JSON line (a directory
listing or a single base64-encoded file). The Supervisor polls the Job, reads
its pod log, parses the result, and deletes the Job (a TTL is a backstop). This
does **not** touch instance lifecycle state, so creating it from the API process
is fine (it's analogous to the logs route's read — see the inspector-service and
storage-route header comments). No new RBAC is needed: it reuses the existing
`jobs: create,delete` + `pods/log: get` grants.

- `GET /api/instances/:id/storage?path=<p>` → `{ listing }` (dirs + files).
- `GET /api/instances/:id/storage/file?path=<p>` → streams the file as an
  attachment.

**Limitations**: read-only (no upload/delete); a **few-second latency** per
action (the Job round-trip); files over **5 MiB** can't be downloaded here (use a
terminal → `413`); and if a **Stopped** workspace's storage is **node-pinned**
(local-path), the inspector can't mount it — the UI shows a note telling the
operator to **Start** the instance first (NFS/RWX volumes schedule anywhere, so
they browse fine while stopped). Like the logs/events surfaces, the list endpoint
degrades to an empty listing + a `note` when no cluster is reachable (never 500).

## Storage targets

Each instance picks **where its persistent data lives** at create time. Targets
are surfaced in the create-instance dropdown, each with a **resiliency note** so
the operator sees the trade-off. Options come from three sources:

| Source | Option id | Discovered from | Kind |
|--------|-----------|-----------------|------|
| Cluster default | `default` | `SUPERVISOR_DEFAULT_STORAGE_CLASS`/`_SIZE` (env) | storage-class |
| StorageClass | `sc:<name>` | live `listStorageClass()` | storage-class, or **cloud-csi** for a known cloud CSI provisioner |
| Node (local-path) | `node:<host>` | live `listNode()` (control-plane nodes skipped) | local-path (node-pinned) |
| Registered NFS/custom | `reg:<uuid>` | `registered_storage_target` table | nfs / custom |

Provisioner detection:

- `driver.longhorn.io` → *"Replicated (Longhorn); survives node loss."*
- `ebs.csi.aws.com` / `pd.csi.storage.gke.io` / `disk.csi.azure.com` →
  cloud-csi, *"Cloud volume; reattaches on node loss within its AZ."*
- local-path → *"Node-pinned (local-path); NO replication — data is lost if the
  node is lost."*

The chosen target's config is **snapshotted** into `instance.storageConfigSnapshot`
at create time. The reconciler builds the PVC `volumeClaimTemplate` from that
snapshot (never by re-resolving the target live), so editing or deleting a target
later **never changes an existing instance's volume** — it only affects future
dropdowns.

### API

```
GET    /api/storage-targets        viewer   live discovery (default + SCs + nodes + registered)
POST   /api/storage-targets        admin    register an NFS/custom target
DELETE /api/storage-targets/:id    admin    delete a registered (reg:<uuid>) target
```

`POST` body: `{ name, kind, config, resiliencyNote?, isDefault? }`. For **NFS**,
prefer the dynamic `nfs-subdir-external-provisioner` StorageClass over a static
PV (§15 B3) — put its name in `config.storageClassName`, e.g.
`{ "name": "office-nfs", "kind": "nfs", "config": { "storageClassName": "nfs-client" } }`.
Only `reg:<uuid>` targets are deletable; `sc:`/`node:`/`default` are discovered
(not stored) and return `400`. Deleting a target does **not** affect existing
instances (their config is snapshotted).

Resilience: if no cluster is reachable (local dev without `KUBECONFIG`), discovery
degrades to the `default` option + any registered rows rather than failing.

If no `storageTargetId` is supplied to `POST /api/instances`, the cluster default
is used.

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
- `SUPERVISOR_CF_ACCESS_TEAM` / `SUPERVISOR_CF_ACCESS_AUD` — the CF Access team/AUD the Supervisor validates. Under the single-front-door model this is the **one** CF Access app fronting the host, so these equal the instances' `CF_ACCESS_TEAM` / `CF_ACCESS_AUD`.
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
